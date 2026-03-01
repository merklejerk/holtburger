use crate::ui::types::CommandTarget;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::render::render_inventory_tab;
use crate::ui::Interaction;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;

use crate::pages::game::dashboard::filter::{EntityFilter, filter_entities};
use crate::ui::Verb;
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::ClientCommand;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;

pub struct InventoryTab;

pub fn get_entities(game: &GameState) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &game.data.entities,
        &game.data.inventory,
        &game.data.equipment,
        game.data.player_pos.as_ref(),
        None, // Inventory doesn't care about open containers
        EntityFilter::Inventory,
    )
}

impl TabController for InventoryTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_inventory_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let entities = get_entities(game);

        if let Some((e, _, _)) = entities.get(index) {
            let class = classification::classify_entity(e);
            let player_guid = game.data.player_guid;

            // Handle Interactions
            match interaction {
                Some(Interaction::Healing { item_guid }) => {
                    if e.guid == *item_guid {
                        if let Some(pguid) = player_guid {
                            let msgs = vec![
                                crate::ui::UiMessage::SendCommands(vec![
                                    ClientCommand::UseWithTarget {
                                        item: *item_guid,
                                        target: pguid,
                                    },
                                ]),
                                crate::ui::UiMessage::CancelInteraction,
                            ];
                            verbs.push(Verb::new(msgs, '\r', "Heal yourself".to_string()));
                        }
                    }
                    return verbs;
                }
                Some(Interaction::Combining { item_guid }) => {
                    if let Some(source_e) = game.data.entities.get(item_guid)
                        && let Some(target_type) = source_e.target_item_type()
                        && let Some(dest_item_type) = e.item_type()
                        && target_type.intersects(dest_item_type)
                    {
                        let msgs = vec![
                            crate::ui::UiMessage::SendCommands(vec![
                                ClientCommand::UseWithTarget {
                                    item: *item_guid,
                                    target: e.guid,
                                },
                            ]),
                            crate::ui::UiMessage::CancelInteraction,
                        ];
                        verbs.push(Verb::new(msgs, '\r', "Apply to target".to_string()));
                    }
                    return verbs;
                }
                Some(Interaction::Targeting { target_guid: _ }) => {
                    return verbs;
                }
                Some(Interaction::Moving { item_guid }) => {
                    let is_self = Some(e.guid) == player_guid;
                    let is_same_item = &e.guid == item_guid;
                    let is_in_main_pack = game.data.is_in_main_pack(*item_guid);
                    let is_container = matches!(class, EntityClass::Container | EntityClass::Chest);

                    let mut is_merge = false;
                    let mut cmd = None;

                    let merge_label = game.data.entities.get(item_guid).and_then(|source_e| {
                        if !is_same_item
                            && source_e.is_stackable()
                            && source_e.wcid == e.wcid
                            && e.stack_size() < e.max_stack_size()
                        {
                            is_merge = true;
                            let source_size = source_e.stack_size();
                            let dest_size = e.stack_size();
                            let dest_max = e.max_stack_size();
                            let space = dest_max.saturating_sub(dest_size);
                            let amount = source_size.min(space) as i32;
                            cmd = Some(ClientCommand::Stack {
                                source: *item_guid,
                                destination: e.guid,
                                amount,
                            });
                            Some("Merge".to_string())
                        } else {
                            None
                        }
                    });

                    let label = if is_self || is_same_item {
                        if !is_in_main_pack {
                            cmd = Some(ClientCommand::MoveItem {
                                item: *item_guid,
                                container: player_guid.unwrap(),
                                placement: 0,
                            });
                            Some("Move to main pack".to_string())
                        } else {
                            None
                        }
                    } else if let Some(merge) = merge_label {
                        Some(merge)
                    } else if is_container {
                        cmd = Some(ClientCommand::MoveItem {
                            item: *item_guid,
                            container: e.guid,
                            placement: 0,
                        });
                        Some("Move to container".to_string())
                    } else {
                        None
                    };

                    if let Some(label) = label
                        && let Some(cmd) = cmd
                    {
                        let msgs = vec![
                            crate::ui::UiMessage::SendCommands(vec![cmd]),
                            crate::ui::UiMessage::CancelInteraction,
                        ];
                        verbs.push(Verb::new(msgs, '\r', label));
                    }
                    return verbs;
                }
                _ => {}
            }

            // Normal Options
            verbs.push(Verb::new(
                vec![
                    crate::ui::UiMessage::SendCommands(vec![ClientCommand::Identify(e.guid)]),
                    crate::ui::UiMessage::ChangeContextView(crate::ui::ContextView::Assess(e.guid)),
                ],
                'a',
                "Assess",
            ));

            match class {
                EntityClass::Unknown
                | EntityClass::Tool
                | EntityClass::Container
                | EntityClass::Consumable
                | EntityClass::Key
                | EntityClass::Writable
                | EntityClass::Money
                | EntityClass::Item => {
                    if e.target_item_type().is_some() {
                        verbs.push(Verb::new(
                            vec![crate::ui::UiMessage::BeginInteraction(
                                Interaction::Combining { item_guid: e.guid },
                            )],
                            'c',
                            "Combine",
                        ));
                    } else if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
                        verbs.push(Verb::new(
                            vec![crate::ui::UiMessage::BeginInteraction(
                                Interaction::Healing { item_guid: e.guid },
                            )],
                            'u',
                            "Use",
                        ));
                    } else {
                        verbs.push(Verb::new(
                            vec![crate::ui::UiMessage::SendCommands(vec![
                                ClientCommand::Use(e.guid),
                            ])],
                            'u',
                            "Use",
                        ));
                    }
                }
                EntityClass::Apparel | EntityClass::Wand | EntityClass::Weapon => {
                    verbs.push(Verb::new(
                        vec![crate::ui::UiMessage::BeginInteraction(
                            Interaction::Targeting {
                                target_guid: e.guid,
                            },
                        )],
                        't',
                        "Target",
                    ));
                }
                _ => {}
            }

            if !e.is_attuned_sticky() {
                verbs.push(Verb::new(
                    vec![crate::ui::UiMessage::SendCommands(vec![
                        ClientCommand::Drop(e.guid),
                    ])],
                    'd',
                    "Drop",
                ));
            }

            if e.stack_size() > 1 {
                // To split we show a popup. In old code it fired Action::Split. Now we just trigger CancelInteraction for now due to complex split dialog logic, wait we don't have Split generic.
                // Wait, I will just emit `crate::ui::UiMessage::BeginInteraction(Interaction::Splitting { item_guid: e.guid })` or similar? Wait we don't have splitting. Let's just ignore split for now or I can add it to interaction. No, Wait! I didn't see `Action::Split` implementation anywhere! I'll just omit it, wait it was dropping into some input loop before. No! Wait `ConfirmInteractionSplit` is a UiMessage!!
                verbs.push(Verb::new(
                    vec![crate::ui::UiMessage::BeginInteraction(
                        Interaction::Splitting {
                            item_guid: e.guid,
                            max_amount: e.stack_size() as i32,
                        },
                    )],
                    'p',
                    "Split",
                ));
            }

            if !e
                .flags
                .intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT)
            {
                verbs.push(Verb::new(
                    vec![crate::ui::UiMessage::BeginInteraction(
                        Interaction::Moving { item_guid: e.guid },
                    )],
                    'm',
                    "Move",
                ));
            }

            let is_equipped = if let (Some(pguid), Some(wielder)) = (player_guid, e.wielder_id()) {
                pguid == wielder
            } else {
                false
            };

            if let Some(trade) = &game.data.trade
                && !is_equipped
                && !trade.self_side.items.contains(&e.guid)
                && game.data.can_add_to_trade(e.guid)
            {
                verbs.push(Verb::new(
                    vec![crate::ui::UiMessage::SendCommands(vec![
                        ClientCommand::AddToTrade { item: e.guid },
                    ])],
                    'o',
                    "Offer",
                ));
            } else if game.data.vendor.is_some() && game.data.can_sell_to_vendor(e.guid) {
                verbs.push(Verb::new(
                    vec![
                        crate::ui::UiMessage::SendCommands(vec![
                            ClientCommand::Sell {
                                vendor: game.data.vendor.as_ref().unwrap().vendor_guid,
                                items: vec![
                                    holtburger_protocol::messages::trade::actions::ItemProfileActionData {
                                        object_guid: e.guid,
                                        amount: 1,
                                    },
                                ],
                            }
                        ])
                    ],
                    's',
                    "Sell"
                ));
            }
        }
        verbs
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        let entities = get_entities(game);
        entities
            .get(index)
            .map(|(e, _, _)| CommandTarget::Entity(e, None))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        get_entities(game).len()
    }
}
