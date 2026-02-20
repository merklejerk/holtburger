use super::super::common::{Action, Verb};

pub fn get_verbs(xp_cost: bool, sp_cost: bool) -> Vec<Verb> {
    let mut verbs = Vec::new();

    if xp_cost {
        verbs.push(Verb::new(Action::LevelUp, 'l', "Level Up"));
    }

    if sp_cost {
        verbs.push(Verb::new(Action::Train, 'n', "Train"));
    }

    verbs
}
