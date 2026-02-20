use super::super::common::{Action, Verb};

pub fn get_verbs(is_targeted: bool) -> Vec<Verb> {
    let label = if is_targeted {
        "Cast on target"
    } else {
        "Cast on self"
    };
    vec![
        Verb::new(Action::Cast(is_targeted), 'c', label),
        Verb::new(Action::Debug, 'b', "Debug"),
    ]
}
