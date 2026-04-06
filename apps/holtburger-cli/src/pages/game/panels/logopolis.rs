use ratatui::text::Line;

const BALL_INITIAL_SPEED: f32 = 0.52;
const BALL_MAX_SPEED: f32 = 1.10;
const BALL_SPEED_BOOST: f32 = 1.03;
const BALL_X_SPREAD: f32 = 0.72;
const BALL_MIN_X_COMPONENT: f32 = 0.12;
const BALL_HIT_HALF_WIDTH: f32 = 0.04;
const BALL_HIT_HALF_HEIGHT: f32 = 0.04;
const MISS_RESTART_DELAY: f32 = 1.0;
const PADDLE_SPEED: f32 = 0.50;
const PADDLE_LENGTH_RATIO: f32 = 0.16;
const AI_DEADZONE: f32 = 0.015;
const AI_SCORE_SCALE_CAP: f32 = 12.0;
const AI_BASE_SPEED_MULTIPLIER: f32 = 0.24;
const AI_SPEED_MULTIPLIER_BONUS: f32 = 0.14;
const AI_BASE_NOISE_RADIUS: f32 = 0.05;
const AI_NOISE_RADIUS_DECAY: f32 = 0.03;
const AI_CENTER_TARGET: f32 = 0.5;
const AI_TARGET_SMOOTHING_RATE: f32 = 1.6;

#[derive(Debug, Clone)]
pub struct LogopolisState {
    ball_x: f32,
    ball_y: f32,
    ball_vx: f32,
    ball_vy: f32,
    top_paddle_x: f32,
    bottom_paddle_x: f32,
    top_score: u32,
    bottom_score: u32,
    restart_in: f32,
    restart_to_bottom: Option<bool>,
    ai_rng_state: u32,
    ai_target_x: f32,
}

impl Default for LogopolisState {
    fn default() -> Self {
        Self::new()
    }
}

impl LogopolisState {
    pub fn new() -> Self {
        let mut state = Self {
            ball_x: 0.5,
            ball_y: 0.5,
            ball_vx: 0.0,
            ball_vy: 0.0,
            top_paddle_x: 0.5,
            bottom_paddle_x: 0.5,
            top_score: 0,
            bottom_score: 0,
            restart_in: 0.0,
            restart_to_bottom: None,
            ai_rng_state: 0xA5A5_1234,
            ai_target_x: 0.5,
        };
        state.serve(false);
        state
    }

    pub fn tick(&mut self, elapsed: std::time::Duration) {
        let dt = elapsed.as_secs_f32();
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }

        if self.restart_in > 0.0 {
            self.restart_in = (self.restart_in - dt).max(0.0);
            if self.restart_in > 0.0 {
                return;
            }

            if let Some(to_bottom) = self.restart_to_bottom.take() {
                self.serve(to_bottom);
            }
            return;
        }

        self.update_top_paddle_ai(dt);

        self.ball_x += self.ball_vx * dt;
        self.ball_y += self.ball_vy * dt;

        if self.ball_x < 0.0 {
            self.ball_x = -self.ball_x;
            self.ball_vx = self.ball_vx.abs();
        } else if self.ball_x > 1.0 {
            self.ball_x = 2.0 - self.ball_x;
            self.ball_vx = -self.ball_vx.abs();
        }

        if self.ball_vy < 0.0 && self.ball_y <= BALL_HIT_HALF_HEIGHT {
            if overlaps_range(
                self.ball_x,
                BALL_HIT_HALF_WIDTH,
                self.top_paddle_x,
                PADDLE_LENGTH_RATIO / 2.0,
            ) {
                self.ball_y = BALL_HIT_HALF_HEIGHT;
                self.bounce_off_paddle(false);
            } else {
                self.bottom_score = self.bottom_score.saturating_add(1);
                self.begin_restart(false, 0.0);
                return;
            }
        }

        if self.ball_vy > 0.0 && self.ball_y >= 1.0 - BALL_HIT_HALF_HEIGHT {
            if overlaps_range(
                self.ball_x,
                BALL_HIT_HALF_WIDTH,
                self.bottom_paddle_x,
                PADDLE_LENGTH_RATIO / 2.0,
            ) {
                self.ball_y = 1.0 - BALL_HIT_HALF_HEIGHT;
                self.bounce_off_paddle(true);
            } else {
                self.top_score = self.top_score.saturating_add(1);
                self.begin_restart(true, 1.0);
            }
        }
    }

    pub fn score_title(&self) -> String {
        format!(
            "You: {} - Bael'Zharon: {}",
            self.bottom_score, self.top_score
        )
    }

    fn is_round_active(&self) -> bool {
        self.restart_in <= 0.0
    }

    pub fn nudge_player_paddle(&mut self, delta: f32) -> bool {
        if !self.is_round_active() {
            return false;
        }

        self.bottom_paddle_x = clamp_paddle_center(self.bottom_paddle_x + delta);
        true
    }

    pub fn render_lines(&self, width: usize, height: usize) -> Vec<Line<'static>> {
        if width == 0 || height == 0 {
            return Vec::new();
        }

        let mut cells = vec![vec![' '; width]; height];
        self.draw_paddle_row(&mut cells, 0, self.top_paddle_x);
        self.draw_paddle_row(&mut cells, height - 1, self.bottom_paddle_x);
        self.draw_ball(&mut cells);

        cells
            .into_iter()
            .map(|row| Line::from(row.into_iter().collect::<String>()))
            .collect()
    }

    fn serve(&mut self, to_bottom: bool) {
        self.restart_in = 0.0;
        self.restart_to_bottom = None;
        self.ball_x = 0.5;
        self.ball_y = 0.5;
        self.top_paddle_x = 0.5;
        self.bottom_paddle_x = 0.5;
        self.ai_target_x = 0.5;

        let direction = if to_bottom { 1.0 } else { -1.0 };
        let horizontal_bias = if (self.top_score + self.bottom_score).is_multiple_of(2) {
            0.14
        } else {
            -0.14
        };

        self.set_velocity(horizontal_bias, direction, BALL_INITIAL_SPEED);
    }

    fn begin_restart(&mut self, to_bottom: bool, edge_y: f32) {
        self.ball_x = self.ball_x.clamp(0.0, 1.0);
        self.ball_y = edge_y.clamp(0.0, 1.0);
        self.ball_vx = 0.0;
        self.ball_vy = 0.0;
        self.restart_in = MISS_RESTART_DELAY;
        self.restart_to_bottom = Some(to_bottom);
    }

    fn bounce_off_paddle(&mut self, from_bottom: bool) {
        let speed = (self.ball_speed() * BALL_SPEED_BOOST).min(BALL_MAX_SPEED);
        let paddle_x = if from_bottom {
            self.bottom_paddle_x
        } else {
            self.top_paddle_x
        };
        let paddle_offset =
            ((self.ball_x - paddle_x) / (PADDLE_LENGTH_RATIO / 2.0)).clamp(-1.0, 1.0);
        let mut horizontal_component = (paddle_offset * BALL_X_SPREAD).clamp(-0.85, 0.85);

        if horizontal_component.abs() < BALL_MIN_X_COMPONENT {
            horizontal_component =
                BALL_MIN_X_COMPONENT * if self.ball_x < 0.5 { -1.0 } else { 1.0 };
        }

        let vertical_component = if from_bottom { -1.0 } else { 1.0 };
        self.set_velocity(horizontal_component, vertical_component, speed);
    }

    fn set_velocity(&mut self, horizontal: f32, vertical: f32, speed: f32) {
        let magnitude = (horizontal * horizontal + vertical * vertical).sqrt();
        let normalized = if magnitude > 0.0 { magnitude } else { 1.0 };
        self.ball_vx = horizontal / normalized * speed;
        self.ball_vy = vertical / normalized * speed;
    }

    fn ball_speed(&self) -> f32 {
        (self.ball_vx * self.ball_vx + self.ball_vy * self.ball_vy).sqrt()
    }

    fn predict_ai_target_x(&self) -> f32 {
        if self.ball_vy < 0.0 {
            let time_to_top = (self.ball_y / self.ball_vy.abs()).clamp(0.0, 1.5);
            (self.ball_x + self.ball_vx * time_to_top).clamp(0.0, 1.0)
        } else {
            AI_CENTER_TARGET
        }
    }

    fn update_top_paddle_ai(&mut self, dt: f32) {
        let profile = self.ai_control_profile();
        let mut desired_target = self.predict_ai_target_x();
        if (desired_target - self.top_paddle_x).abs() <= AI_DEADZONE {
            desired_target = self.top_paddle_x;
        }

        if self.ball_vy < 0.0 {
            let noise = (self.next_ai_noise() - 0.5) * 2.0 * profile.noise_radius;
            desired_target = clamp_paddle_center(desired_target + noise);
        }

        self.ai_target_x = clamp_paddle_center(lerp(
            self.ai_target_x,
            desired_target,
            (AI_TARGET_SMOOTHING_RATE * dt).clamp(0.0, 1.0),
        ));

        self.top_paddle_x = clamp_paddle_center(move_towards(
            self.top_paddle_x,
            self.ai_target_x,
            PADDLE_SPEED * profile.speed_multiplier * dt,
        ));
    }

    fn ai_control_profile(&self) -> AiControlProfile {
        let score_progress =
            (self.bottom_score as f32).min(AI_SCORE_SCALE_CAP) / AI_SCORE_SCALE_CAP;
        AiControlProfile {
            speed_multiplier: AI_BASE_SPEED_MULTIPLIER + score_progress * AI_SPEED_MULTIPLIER_BONUS,
            noise_radius: AI_BASE_NOISE_RADIUS - score_progress * AI_NOISE_RADIUS_DECAY,
        }
    }

    fn next_ai_noise(&mut self) -> f32 {
        let mut state = self.ai_rng_state;
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        self.ai_rng_state = if state == 0 { 0xA5A5_1234 } else { state };
        (self.ai_rng_state as f32) / (u32::MAX as f32)
    }

    fn draw_paddle_row(&self, cells: &mut [Vec<char>], row: usize, paddle_x: f32) {
        let height = cells.len();
        let width = cells.first().map(|row| row.len()).unwrap_or(0);

        if height == 0 || width == 0 || row >= height {
            return;
        }

        let paddle_length = (width as f32 * PADDLE_LENGTH_RATIO)
            .round()
            .min(width as f32) as usize;
        let center_column = normalized_to_column(clamp_paddle_center(paddle_x), width);
        let half_length = paddle_length / 2;
        let start = center_column.saturating_sub(half_length);
        let end = (start + paddle_length).min(width);

        for cell in cells[row].iter_mut().take(end).skip(start) {
            *cell = '█';
        }
    }

    fn draw_ball(&self, cells: &mut [Vec<char>]) {
        let height = cells.len();
        let width = cells.first().map(|row| row.len()).unwrap_or(0);

        if height < 3 || width < 3 {
            return;
        }

        let row = normalized_to_row(self.ball_y, height);
        let column = normalized_to_column(self.ball_x, width);
        let ball_width = if width >= 5 { 3 } else { 2 };
        let row_start = row;
        let col_start = column.saturating_sub(ball_width / 2);
        let col_end = (col_start + ball_width).min(width);

        for cell in cells[row_start].iter_mut().take(col_end).skip(col_start) {
            *cell = '█';
        }
    }
}

fn move_towards(current: f32, target: f32, max_step: f32) -> f32 {
    let delta = (target - current).clamp(-max_step, max_step);
    (current + delta).clamp(0.0, 1.0)
}

fn lerp(current: f32, target: f32, amount: f32) -> f32 {
    current + (target - current) * amount.clamp(0.0, 1.0)
}

fn clamp_paddle_center(value: f32) -> f32 {
    let half_span = PADDLE_LENGTH_RATIO / 2.0;
    value.clamp(half_span, 1.0 - half_span)
}

fn overlaps_range(center_a: f32, half_width_a: f32, center_b: f32, half_width_b: f32) -> bool {
    let min_a = (center_a - half_width_a).clamp(0.0, 1.0);
    let max_a = (center_a + half_width_a).clamp(0.0, 1.0);
    let min_b = (center_b - half_width_b).clamp(0.0, 1.0);
    let max_b = (center_b + half_width_b).clamp(0.0, 1.0);
    max_a >= min_b && max_b >= min_a
}

#[derive(Debug, Clone, Copy)]
struct AiControlProfile {
    speed_multiplier: f32,
    noise_radius: f32,
}

fn normalized_to_row(value: f32, height: usize) -> usize {
    if height <= 1 {
        return 0;
    }

    let max_row = (height - 1) as f32;
    (value.clamp(0.0, 1.0) * max_row)
        .round()
        .clamp(0.0, max_row) as usize
}

fn normalized_to_column(value: f32, width: usize) -> usize {
    if width <= 1 {
        return 0;
    }

    let max_column = (width - 1) as f32;
    (value.clamp(0.0, 1.0) * max_column)
        .round()
        .clamp(0.0, max_column) as usize
}

#[cfg(test)]
mod tests {
    use super::{AiControlProfile, BALL_HIT_HALF_WIDTH, LogopolisState, PADDLE_LENGTH_RATIO};

    #[test]
    fn score_title_reflects_current_score() {
        let game = LogopolisState::new();

        assert_eq!(game.score_title(), "You: 0 - Bael'Zharon: 0");
    }

    #[test]
    fn render_lines_match_requested_dimensions() {
        let game = LogopolisState::new();
        let lines = game.render_lines(18, 8);

        assert_eq!(lines.len(), 8);
        let rendered = lines
            .iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(rendered.contains('█'));
        assert!(!rendered.contains('|'));
        assert!(!rendered.contains('-'));
    }

    #[test]
    fn edge_collision_counts_when_ball_overlaps_paddle_by_radius() {
        let mut game = LogopolisState::new();
        game.bottom_paddle_x = 0.5;
        game.ball_x = 0.5 + (PADDLE_LENGTH_RATIO / 2.0) + BALL_HIT_HALF_WIDTH - 0.001;
        game.ball_y = 1.0;
        game.ball_vx = 0.0;
        game.ball_vy = 0.2;

        game.tick(std::time::Duration::from_millis(16));

        assert_eq!(game.top_score, 0);
        assert_eq!(game.bottom_score, 0);
    }

    #[test]
    fn miss_waits_before_restart() {
        let mut game = LogopolisState::new();
        game.top_paddle_x = 0.1;
        game.ball_x = 0.9;
        game.ball_y = 0.01;
        game.ball_vx = 0.0;
        game.ball_vy = -1.0;

        game.tick(std::time::Duration::from_millis(16));

        assert_eq!(game.bottom_score, 1);
        assert_eq!(game.top_score, 0);
        assert_eq!(game.ball_y, 0.0);
        assert_eq!(game.ball_vx, 0.0);
        assert_eq!(game.ball_vy, 0.0);
        assert!(game.restart_in > 0.0);

        game.tick(std::time::Duration::from_millis(1100));

        assert_eq!(game.restart_in, 0.0);
        assert_eq!(game.ball_x, 0.5);
        assert_eq!(game.ball_y, 0.5);
    }

    #[test]
    fn player_paddle_does_not_move_while_round_is_paused() {
        let mut game = LogopolisState::new();
        game.restart_in = 1.0;
        game.bottom_paddle_x = 0.5;

        assert!(!game.nudge_player_paddle(0.2));

        assert_eq!(game.bottom_paddle_x, 0.5);
    }

    #[test]
    fn ai_profile_scales_with_player_score() {
        let mut game = LogopolisState::new();
        let baseline: AiControlProfile = game.ai_control_profile();
        game.bottom_score = 12;
        let harder: AiControlProfile = game.ai_control_profile();

        assert!(harder.speed_multiplier > baseline.speed_multiplier);
        assert!(harder.noise_radius < baseline.noise_radius);
    }

    #[test]
    fn ai_target_moves_smoothly_toward_new_demand() {
        let mut game = LogopolisState::new();
        game.ball_y = 0.2;
        game.ball_vy = -0.3;
        game.ball_x = 0.9;
        game.top_paddle_x = 0.1;
        game.ai_target_x = 0.1;

        game.update_top_paddle_ai(0.016);
        let first = game.top_paddle_x;

        game.ball_x = 0.2;
        game.ball_vy = -0.3;
        game.update_top_paddle_ai(0.016);
        let second = game.top_paddle_x;

        assert!(second >= first);
        assert!((second - first) < 0.2);
    }
}
