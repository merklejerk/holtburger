//! Reduce housing responses without assigning frontend interaction policy.

use crate::housing::management::{HousingAccessRecords, HousingSearchResults};
use crate::housing::{HomeKnowledge, HousingCrystal, HousingHome, HousingHomeUpdateSource};
use crate::{WorldEvent, WorldState};
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::{GameEvent, GameEventMessage};

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    let source = if matches!(
        event.event,
        GameEvent::HouseData(_) | GameEvent::HouseStatus(_)
    ) {
        HousingHomeUpdateSource::Complete
    } else {
        HousingHomeUpdateSource::Maintenance
    };
    let result = match &event.event {
        GameEvent::HouseData(data) => HousingHome::try_from(data.as_ref()).map(|home| {
            state.housing.replace_home(HomeKnowledge::Owned {
                home: Box::new(home),
            });
        }),
        GameEvent::HouseProfile(data) => {
            match HousingCrystal::from_profile(data.crystal, &data.profile) {
                Ok(crystal) => {
                    state.housing.crystal = Some(crystal.clone());
                    events.push(WorldEvent::HousingCrystalReceived(Box::new(crystal)));
                    return true;
                }
                Err(error) => {
                    events.push(WorldEvent::HousingCrystalRejected(error));
                    return true;
                }
            }
        }
        GameEvent::HouseStatus(data) => {
            // ACE also sends HouseEvicted during login bookkeeping; that notice
            // is not an authoritative empty-query response.
            if data.status == WeenieError::BadParam as u32 {
                state.housing.replace_home(HomeKnowledge::None);
            }
            events.push(WorldEvent::HousingStatusReceived(data.status));
            if data.status != WeenieError::BadParam as u32 {
                return true;
            }
            Ok(())
        }
        GameEvent::UpdateRentTime(data) => {
            if let HomeKnowledge::Owned { home } = &mut state.housing.home {
                home.update_rent_time(data.rent_time);
            } else {
                events.push(WorldEvent::HousingRefreshRequired);
                return true;
            }
            Ok(())
        }
        GameEvent::UpdateRentPayment(data) => {
            if let HomeKnowledge::Owned { home } = &mut state.housing.home {
                home.update_rent(&data.payments)
            } else {
                events.push(WorldEvent::HousingRefreshRequired);
                return true;
            }
        }
        GameEvent::HouseTransaction(data) => {
            events.push(WorldEvent::HousingTransactionNotice(data.notice));
            return true;
        }
        GameEvent::UpdateHar(data) => {
            match HousingAccessRecords::try_from(data.as_ref()) {
                Ok(access) => {
                    state.housing.access = Some(access.clone());
                    events.push(WorldEvent::HousingAccessUpdated(Box::new(access)));
                }
                Err(error) => events.push(WorldEvent::HousingAccessRejected(error)),
            }
            return true;
        }
        GameEvent::AvailableHouses(data) => {
            match HousingSearchResults::try_from(data.as_ref()) {
                Ok(result) => {
                    state.housing.search = Some(result.clone());
                    events.push(WorldEvent::HousingSearchUpdated(Box::new(result)));
                }
                Err(error) => events.push(WorldEvent::HousingSearchRejected(error)),
            }
            return true;
        }
        _ => return false,
    };
    match result {
        Ok(()) => events.push(WorldEvent::HousingHomeUpdated {
            home: state.housing.home.clone(),
            source,
        }),
        Err(error) => events.push(WorldEvent::HousingDataRejected { source, error }),
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::housing::LANDSCAPE_MAINTENANCE_SECONDS;
    use holtburger_common::{Guid, position::WorldPosition};
    use holtburger_protocol::messages::{
        GameMessage, HouseData, HousePayment, HouseRentPaymentEventData, HouseRentTimeEventData,
        HouseStatusEventData,
    };

    fn receive(world: &mut WorldState, event: GameEvent) -> Vec<WorldEvent> {
        world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: world.player.guid,
            sequence: 1,
            event,
        })))
    }

    fn requirement(paid: i32) -> HousePayment {
        HousePayment {
            required: 10,
            paid,
            wcid: crate::currency::PYREAL_WCID,
            name: "Pyreal".into(),
            plural_name: "Pyreals".into(),
        }
    }

    fn home(house_type: u32) -> HouseData {
        HouseData {
            buy_time: 100,
            rent_time: 200,
            house_type,
            maintenance_free: false,
            buy: Vec::new(),
            rent: vec![requirement(4)],
            position: WorldPosition {
                landblock_id: Guid(0x12340001),
                ..Default::default()
            },
        }
    }

    fn access() -> holtburger_protocol::messages::HouseAccess {
        use holtburger_protocol::messages::{
            HouseAccess, HouseAccessFormat, HouseGuest, HouseGuestTable,
        };
        HouseAccess {
            format: HouseAccessFormat::Version2 {
                flags: 0x80000005,
                monarch: Guid(10),
                roommates: vec![Guid(20)],
            },
            guests: HouseGuestTable {
                buckets: 64,
                entries: vec![HouseGuest {
                    character: Guid(30),
                    name: "Guest".into(),
                    storage_allowed: true,
                }],
            },
        }
    }

    #[test]
    fn access_flags_are_normalized_once_and_do_not_identify_a_home_owner() {
        let mut world = WorldState::synthetic();
        receive(&mut world, GameEvent::HouseData(Box::new(home(1))));
        let events = receive(&mut world, GameEvent::UpdateHar(Box::new(access())));
        let records = world.housing.access.as_ref().unwrap();
        assert!(records.public_entry);
        assert!(records.guests[0].storage_allowed);
        assert_eq!(records.roommates, Some(vec![Guid(20)]));
        let allegiance = records.allegiance.as_ref().unwrap();
        assert_eq!(allegiance.flags, 0x80000005);
        assert_eq!(allegiance.monarch, Guid(10));
        assert!(allegiance.entry_allowed);
        assert!(allegiance.storage_allowed);
        assert!(
            events
                .iter()
                .any(|event| matches!(event, WorldEvent::HousingAccessUpdated(_)))
        );
    }

    #[test]
    fn legacy_access_leaves_undisclosed_allegiance_and_roommates_unknown() {
        use holtburger_protocol::messages::HouseAccessFormat;
        let mut world = WorldState::synthetic();
        let mut record = access();
        record.format = HouseAccessFormat::Legacy { open_status: 1 };
        receive(&mut world, GameEvent::UpdateHar(Box::new(record)));
        let records = world.housing.access.as_ref().unwrap();
        assert!(records.public_entry);
        assert!(records.allegiance.is_none());
        assert!(records.roommates.is_none());
    }

    #[test]
    fn duplicate_guest_rejection_retains_access_and_does_not_finish_home_query() {
        let mut world = WorldState::synthetic();
        receive(&mut world, GameEvent::UpdateHar(Box::new(access())));
        let before = world.housing.access.clone();
        let mut invalid = access();
        invalid
            .guests
            .entries
            .push(invalid.guests.entries[0].clone());
        let events = receive(&mut world, GameEvent::UpdateHar(Box::new(invalid)));
        assert_eq!(world.housing.access, before);
        assert!(matches!(
            &events[..],
            [WorldEvent::HousingAccessRejected(_)]
        ));
        assert_eq!(world.housing.home, HomeKnowledge::Unqueried);
    }

    #[test]
    fn maintenance_refresh_retains_access_but_changed_location_or_no_home_retires_it() {
        let mut world = WorldState::synthetic();
        receive(&mut world, GameEvent::HouseData(Box::new(home(1))));
        receive(&mut world, GameEvent::UpdateHar(Box::new(access())));
        let before = world.housing.access.clone();
        let mut updated = home(1);
        updated.rent_time += 10;
        updated.rent[0].paid += 1;
        receive(&mut world, GameEvent::HouseData(Box::new(updated.clone())));
        assert_eq!(world.housing.access, before);
        updated.position.landblock_id = Guid(0x56780001);
        receive(&mut world, GameEvent::HouseData(Box::new(updated)));
        assert!(world.housing.access.is_none());
        receive(&mut world, GameEvent::UpdateHar(Box::new(access())));
        receive(
            &mut world,
            GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                status: WeenieError::BadParam as u32,
            })),
        );
        assert!(world.housing.access.is_none());
    }

    #[test]
    fn available_areas_are_distinct_and_do_not_replace_home_facts() {
        use holtburger_protocol::messages::HouseAvailableHouses;
        let mut world = WorldState::synthetic();
        receive(&mut world, GameEvent::HouseData(Box::new(home(4))));
        let before = world.housing.home.clone();
        receive(
            &mut world,
            GameEvent::AvailableHouses(Box::new(HouseAvailableHouses {
                house_type: 4,
                locations: vec![0xaa550040, 0xaa550040, 0xbb550040],
                total_available: 7,
            })),
        );
        let result = world.housing.search.as_ref().unwrap();
        assert_eq!(result.house_type, 4);
        assert_eq!(result.areas, vec![Guid(0xaa550040), Guid(0xbb550040)]);
        assert_eq!(result.total_available, 7);
        assert_eq!(world.housing.home, before);
    }

    #[test]
    fn invalid_search_counts_retain_prior_results_and_use_separate_rejections() {
        use holtburger_protocol::messages::HouseAvailableHouses;
        let mut world = WorldState::synthetic();
        receive(
            &mut world,
            GameEvent::AvailableHouses(Box::new(HouseAvailableHouses {
                house_type: 1,
                locations: vec![],
                total_available: 0,
            })),
        );
        let before = world.housing.search.clone();
        for invalid in [
            HouseAvailableHouses {
                house_type: 1,
                locations: vec![],
                total_available: -1,
            },
            HouseAvailableHouses {
                house_type: 1,
                locations: vec![0xaa550040],
                total_available: 0,
            },
        ] {
            let events = receive(&mut world, GameEvent::AvailableHouses(Box::new(invalid)));
            assert!(matches!(
                &events[..],
                [WorldEvent::HousingSearchRejected(_)]
            ));
            assert_eq!(world.housing.search, before);
        }
    }

    #[test]
    fn incremental_payments_replace_progress_and_advance_next_due() {
        let mut world = WorldState::synthetic();
        receive(&mut world, GameEvent::HouseData(Box::new(home(1))));
        let HomeKnowledge::Owned { home } = &world.housing.home else {
            panic!("home missing")
        };
        assert_eq!(home.rent[0].remaining, 6);
        assert_eq!(
            home.period.as_ref().unwrap().next_due,
            Some(200 + LANDSCAPE_MAINTENANCE_SECONDS)
        );
        receive(
            &mut world,
            GameEvent::UpdateRentPayment(Box::new(HouseRentPaymentEventData {
                payments: vec![requirement(10)],
            })),
        );
        receive(
            &mut world,
            GameEvent::UpdateRentTime(Box::new(HouseRentTimeEventData { rent_time: 300 })),
        );
        let HomeKnowledge::Owned { home } = &world.housing.home else {
            panic!("home missing")
        };
        assert!(home.maintenance_paid);
        assert_eq!(home.rent[0].remaining, 0);
        assert_eq!(
            home.period.as_ref().unwrap().next_due,
            Some(300 + LANDSCAPE_MAINTENANCE_SECONDS * 2)
        );
    }

    #[test]
    fn status_bookkeeping_preserves_home_but_empty_query_clears_it() {
        let mut world = WorldState::synthetic();
        receive(&mut world, GameEvent::HouseData(Box::new(home(2))));
        receive(
            &mut world,
            GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                status: WeenieError::HouseEvicted as u32,
            })),
        );
        assert!(matches!(world.housing.home, HomeKnowledge::Owned { .. }));
        receive(
            &mut world,
            GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                status: WeenieError::BadParam as u32,
            })),
        );
        assert_eq!(world.housing.home, HomeKnowledge::None);
    }

    #[test]
    fn early_incremental_update_requests_a_complete_baseline() {
        let mut world = WorldState::synthetic();
        let events = receive(
            &mut world,
            GameEvent::UpdateRentTime(Box::new(HouseRentTimeEventData { rent_time: 300 })),
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(event, WorldEvent::HousingRefreshRequired))
        );
        assert_eq!(world.housing.home, HomeKnowledge::Unqueried);
    }

    #[test]
    fn invalid_payment_keeps_previous_authoritative_state() {
        let mut world = WorldState::synthetic();
        receive(&mut world, GameEvent::HouseData(Box::new(home(1))));
        let before = world.housing.clone();
        let events = receive(
            &mut world,
            GameEvent::UpdateRentPayment(Box::new(HouseRentPaymentEventData {
                payments: vec![requirement(-1)],
            })),
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(event, WorldEvent::HousingDataRejected { .. }))
        );
        assert_eq!(world.housing, before);
    }

    #[test]
    fn apartment_dates_and_unknown_types_remain_honest() {
        let apartment = HousingHome::try_from(&home(4)).unwrap();
        assert_eq!(apartment.bought_at, None);
        assert_eq!(
            apartment.period.unwrap().end,
            200 + LANDSCAPE_MAINTENANCE_SECONDS * 3
        );
        let unknown = HousingHome::try_from(&home(99)).unwrap();
        assert!(unknown.period.is_none());
        assert_eq!(unknown.house_type, 99);
    }

    #[test]
    fn free_maintenance_has_no_next_due_and_empty_list_is_an_update() {
        let mut data = home(3);
        data.maintenance_free = true;
        let mut home = HousingHome::try_from(&data).unwrap();
        assert_eq!(home.period.as_ref().unwrap().next_due, None);
        home.update_rent(&[]).unwrap();
        assert!(home.rent.is_empty());
        assert!(home.maintenance_paid);
    }
}
