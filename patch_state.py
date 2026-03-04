with open("apps/holtburger-cli/src/state.rs", "r") as f:
    text = f.read()

# Remove game_view
text = text.replace("""    pub fn game_view(&self) -> &ViewState {
        match &self.page {
            Page::Game(game) => &game.view,
            _ => panic!("Accessing ViewState from non-game page!"),
        }
    }

""", "")

# Remove game_view_mut
text = text.replace("""    pub fn game_view_mut(&mut self) -> &mut ViewState {
        match &mut self.page {
            Page::Game(game) => &mut game.view,
            _ => panic!("Accessing ViewState from non-game page!"),
        }
    }

""", "")

# Remove get_container_counts 
text = text.replace("""    pub fn get_container_counts(&self) -> HashMap<Guid, usize> {
        let mut counts = HashMap::new();
        if let Page::Game(game) = &self.page {
            for e in game.data.entities.values() {
                if let Some(cid) = e.container_id() {
                    *counts.entry(cid).or_default() += 1;
                }
            }
        }
        counts
    }

""", "")

text = text.replace("""use crate::pages::game::{GameState, ViewState};""", """use crate::pages::game::GameState;""")

with open("apps/holtburger-cli/src/state.rs", "w") as f:
    f.write(text)
print("Updated state.rs")
