use holtburger_protocol::errors::WeenieError;

pub fn format_weenie_error(error: WeenieError, parameter: Option<&str>) -> String {
    // Some errors have custom formatting templates.
    let template = match error {
        // WeenieError (Parameter-less)
        WeenieError::YoureTooBusy => Some("You're too busy!"),
        WeenieError::YouCantJumpWhileInTheAir => Some("You can't jump while in the air!"),
        WeenieError::YouAreTooTiredToDoThat => Some("You are too tired to do that!"),
        WeenieError::YouCantJumpFromThisPosition => Some("You can't jump from this position"),
        WeenieError::YouKilledYourself => Some("Ack! You killed yourself!"),
        WeenieError::YourFellowshipIsFull => Some("Your Fellowship is full"),
        WeenieError::LockAlreadyUnlocked => Some("The lock is already unlocked."),
        WeenieError::LockedFellowshipCannotRecruitYou => {
            Some("The fellowship is locked, you were not added to the fellowship.")
        }
        WeenieError::FellowshipIsLocked => {
            Some("The fellowship is locked; you cannot open locked fellowships.")
        }

        // WeenieErrorWithString (Parameterized)
        WeenieError::IsTooBusyToAcceptGifts => Some("{} is too busy to accept gifts right now."),
        WeenieError::CannotCarryAnymore => Some("{} cannot carry anymore."),
        WeenieError::YouFailToAffectYouCannotAffectAnyone => {
            Some("You fail to affect {} because you cannot affect anyone!")
        }
        WeenieError::YouFailToAffectTheyCannotBeHarmed => {
            Some("You fail to affect {} because they cannot be harmed!")
        }
        WeenieError::YouFailToAffectWithBeneficialSpells => {
            Some("You fail to affect {} because beneficial spells do not affect them!")
        }
        WeenieError::YouFailToAffectYouAreNotPk => {
            Some("You fail to affect {} because you are not a player killer!")
        }
        WeenieError::YouFailToAffectTheyAreNotPk => {
            Some("You fail to affect {} because they are not a player killer!")
        }
        WeenieError::YouFailToAffectNotSamePkType => Some(
            "You fail to affect {} because you are not the same sort of player killer as them!",
        ),
        WeenieError::YouFailToAffectAcrossHouseBoundary => {
            Some("You fail to affect {} because you are acting across a house boundary!")
        }
        WeenieError::IsNotAcceptingGiftsRightNow => Some("{} is not accepting gifts right now."),
        WeenieError::IsAlreadyOneOfYourFollowers => Some("{} is already one of your followers"),
        WeenieError::CannotHaveAnyMoreVassals => Some("{} cannot have any more Vassals"),
        WeenieError::TradeAiDoesntWant => Some("{} doesn't know what to do with that."),
        WeenieError::YouMustBeAboveLevelToBuyHouse => {
            Some("You must be above level {} to purchase this dwelling.")
        }
        WeenieError::YouMustBeAtOrBelowLevelToBuyHouse => {
            Some("You must be at or below level {} to purchase this dwelling.")
        }
        WeenieError::YouMustBeAboveAllegianceRankToBuyHouse => {
            Some("You must be above allegiance rank {} to purchase this dwelling.")
        }
        WeenieError::YouMustBeAtOrBelowAllegianceRankToBuyHouse => {
            Some("You must be at or below allegiance rank {} to purchase this dwelling.")
        }
        WeenieError::TheWasNotSuitableForSalvaging => {
            Some("The {} was not suitable for salvaging.")
        }
        WeenieError::TheContainsTheWrongMaterial => Some("The {} contains the wrong material."),
        WeenieError::YouMustBeToUseItemMagic => Some("You must be {} to use that item's magic."),
        WeenieError::YourIsTooLowToUseItemMagic => {
            Some("Your {} is too low to use that item's magic.")
        }
        WeenieError::OnlyMayUseItemMagic => Some("Only {} may use that item's magic."),
        WeenieError::YouMustSpecializeToUseItemMagic => {
            Some("You must have {} specialized to use that item's magic.")
        }
        WeenieError::CannotAcceptStackedItems => {
            Some("{} cannot accept stacked objects. Try giving one at a time.")
        }
        WeenieError::YourSkillMustBeTrained => Some(
            "Your {} skill must be trained, not untrained or specialized, in order to be altered in this way!",
        ),
        WeenieError::NotEnoughSkillCreditsToSpecialize => {
            Some("You do not have enough skill credits to specialize your {} skill.")
        }
        WeenieError::TooMuchXpToRecoverFromSkill => Some(
            "You have too many available experience points to be able to absorb the experience points from your {} skill. Please spend some of your experience points and try again.",
        ),
        WeenieError::YourSkillIsAlreadyUntrained => Some("Your {} skill is already untrained!"),
        WeenieError::CannotLowerSkillWhileWieldingItem => Some(
            "You are currently wielding items which require a certain level of {}. Your skill cannot be lowered while you are wielding these items. Please remove these items and try again.",
        ),
        WeenieError::YouHaveSucceededSpecializingSkill => {
            Some("You have succeeded in specializing your {} skill!")
        }
        WeenieError::YouHaveSucceededUnspecializingSkill => {
            Some("You have succeeded in lowering your {} skill from specialized to trained!")
        }
        WeenieError::YouHaveSucceededUntrainingSkill => {
            Some("You have succeeded in untraining your {} skill!")
        }
        WeenieError::CannotUntrainSkillButRecoveredXp => Some(
            "Although you cannot untrain your {} skill, you have succeeded in recovering all the experience you had invested in it.",
        ),
        WeenieError::TooManyCreditsInSpecializedSkills => Some(
            "You have too many credits invested in specialized skills already! Before you can specialize your {} skill, you will need to unspecialize some other skill.",
        ),
        WeenieError::AttributeTransferFromTooLow => Some("{}"),
        WeenieError::AttributeTransferToTooHigh => Some("{}"),
        WeenieError::ItemUnusableOnHookCannotOpen => {
            Some("The {} cannot be used while on a hook and only the owner may open the hook.")
        }
        WeenieError::ItemUnusableOnHookCanOpen => Some(
            "The {} cannot be used while on a hook, use the '@house hooks on' command to make the hook openable.",
        ),
        WeenieError::ItemOnlyUsableOnHook => Some("The {} can only be used while on a hook."),
        WeenieError::FailsToAffectYouTheyCannotAffectAnyone => {
            Some("{} fails to affect you because they cannot affect anyone!")
        }
        WeenieError::FailsToAffectYouYouCannotBeHarmed => {
            Some("{} fails to affect you because you cannot be harmed!")
        }
        WeenieError::FailsToAffectYouTheyAreNotPk => {
            Some("{} fails to affect you because they are not a player killer!")
        }
        WeenieError::FailsToAffectYouYouAreNotPk => {
            Some("{} fails to affect you because you are not a player killer!")
        }
        WeenieError::FailsToAffectYouNotSamePkType => Some(
            "{} fails to affect you because you are not the same sort of player killer as them!",
        ),
        WeenieError::FailsToAffectYouAcrossHouseBoundary => {
            Some("{} fails to affect you across a house boundary!")
        }
        WeenieError::IsAnInvalidTarget => Some("{} is an invalid target."),
        WeenieError::YouAreInvalidTargetForSpellOf => {
            Some("You are an invalid target for the spell of {}.")
        }
        WeenieError::IsAtFullHealth => Some("{} is already at full health!"),
        WeenieError::YouDontHaveAllTheComponents => Some("You don't have all the components."),
        WeenieError::HasNoSpellTargets => {
            Some("{} has no appropriate targets equipped for this spell.")
        }
        WeenieError::YouHaveNoTargetsForSpellOf => {
            Some("You have no appropriate targets equipped for {}'s spell.")
        }
        WeenieError::IsNowOpenFellowship => {
            Some("{} is now an open fellowship; anyone may recruit new members.")
        }
        WeenieError::IsNowClosedFellowship => Some("{} is now a closed fellowship."),
        WeenieError::IsNowLeaderOfFellowship => Some("{} is now the leader of this fellowship."),
        WeenieError::YouHavePassedFellowshipLeadershipTo => {
            Some("You have passed leadership of the fellowship to {}")
        }
        WeenieError::MaxNumberOfHooked => Some(
            "You may not hook any more {} on your house. You already have the maximum number of hooked or you are not permitted to hook any on your type of house.",
        ),
        WeenieError::MaxNumberOfHookedUntilOneIsRemoved => Some(
            "You now have the maximum number of {} hooked. You cannot hook any additional until you remove one or more from your house.",
        ),
        WeenieError::NoLongerMaxNumberOfHooked => {
            Some("You no longer have the maximum number of {} hooked. You may hook additional.")
        }
        WeenieError::IsNotCloseEnoughToYourLevel => Some("{} is not close enough to your level."),
        WeenieError::YouHaveEnteredTheChannel => Some("You have entered the {} channel."),
        WeenieError::YouHaveLeftTheChannel => Some("You have left the {} channel."),
        WeenieError::WillNotReceiveMessage => Some(
            "{} will not receive your message, please use urgent assistance to speak with an in-game representative.",
        ),
        WeenieError::MessageBlocked => Some("Message Blocked: {}"),
        WeenieError::HasBeenAddedToHearList => {
            Some("{} has been added to the list of people you can hear.")
        }
        WeenieError::HasBeenRemovedFromHearList => {
            Some("{} has been removed from the list of people you can hear.")
        }
        WeenieError::FailToRemoveFromLoudList => Some("You fail to remove {} from your loud list."),
        WeenieError::YouAreNowSnoopingOn => Some("You are now snooping on {}."),
        WeenieError::YouAreNoLongerSnoopingOn => Some("You are no longer snooping on {}."),
        WeenieError::YouFailToSnoopOn => Some("You fail to snoop on {}."),
        WeenieError::AttemptedToSnoopOnYou => Some("{} attempted to snoop on you."),
        WeenieError::IsAlreadyBeingSnoopedOn => {
            Some("{} is already being snooped on, only one person may snoop on another at a time.")
        }
        WeenieError::IsInLimbo => Some("{} is in limbo and cannot receive your message."),
        WeenieError::HasBeenBootedFromAllegianceChat => {
            Some("{} has been booted from the allegiance chat room.")
        }
        WeenieError::AccountOfIsAlreadyBannedFromAllegiance => {
            Some("The account of {} is already banned from the allegiance.")
        }
        WeenieError::AccountOfIsNotBannedFromAllegiance => {
            Some("The account of {} is not banned from the allegiance.")
        }
        WeenieError::AccountOfWasNotUnbannedFromAllegiance => {
            Some("The account of {} was not unbanned from the allegiance.")
        }
        WeenieError::AccountOfIsBannedFromAllegiance => {
            Some("The account of {} has been banned from the allegiance.")
        }
        WeenieError::AccountOfIsUnbannedFromAllegiance => {
            Some("The account of {} is no longer banned from the allegiance.")
        }
        WeenieError::ListOfBannedCharacters => Some("Banned Characters: {}"),
        WeenieError::IsBannedFromAllegiance => Some("{} is banned from the allegiance!"),
        WeenieError::IsNowAllegianceOfficer => Some("{} is now an allegiance officer."),
        WeenieError::ErrorSettingAsAllegianceOfficer => Some(
            "An unspecified error occurred while attempting to set {} as an allegiance officer.",
        ),
        WeenieError::IsNoLongerAllegianceOfficer => Some("{} is no longer an allegiance officer."),
        WeenieError::ErrorRemovingAsAllegianceOfficer => Some(
            "An unspecified error occurred while attempting to remove {} as an allegiance officer.",
        ),
        WeenieError::YouMustWaitBeforeCommunicating => {
            Some("You must wait {} before communicating again!")
        }
        WeenieError::IsAlreadyAllegianceOfficerOfThatLevel => {
            Some("{} is already an allegiance officer of that level.")
        }
        WeenieError::TheIsCurrentlyInUse => Some("The {} is currently in use."),
        WeenieError::YouAreNotListeningToChannel => {
            Some("You are not listening to the {} channel!")
        }
        WeenieError::YouSuccededAcquiringAugmentation => {
            Some("Congratulations! You have succeeded in acquiring the {} augmentation.")
        }
        WeenieError::YouSucceededRecoveringXpFromSkillAugmentationNotUntrainable => Some(
            "Although your augmentation will not allow you to untrain your {} skill, you have succeeded in recovering all the experience you had invested in it.",
        ),
        WeenieError::IsAlreadyOnYourFriendsList => Some("{} is already on your friends list!"),
        WeenieError::YouMayOnlyChangeAllegianceNameOnceEvery24Hours => Some(
            "You may only change your allegiance name once every 24 hours. You may change your allegiance name again in {}.",
        ),
        WeenieError::IsTheMonarchAndCannotBePromotedOrDemoted => {
            Some("{} is the monarch and cannot be promoted or demoted.")
        }
        WeenieError::ThatLevelOfAllegianceOfficerIsNowKnownAs => {
            Some("That level of allegiance officer is now known as: {}.")
        }
        WeenieError::YourAllegianceIsCurrently => Some("Your allegiance is currently: {}."),
        WeenieError::YourAllegianceIsNow => Some("Your allegiance is now: {}."),
        WeenieError::YouHavePreApprovedToJoinAllegiance => {
            Some("You have pre-approved {} to join your allegiance.")
        }
        WeenieError::IsAlreadyMemberOfYourAllegiance => {
            Some("{} is already a member of your allegiance!")
        }
        WeenieError::HasBeenPreApprovedToJoinYourAllegiance => {
            Some("{} has been pre-approved to join your allegiance.")
        }
        WeenieError::IsTemporarilyGaggedInAllegianceChat => Some(
            "{} is now temporarily unable to view or speak in allegiance chat. The gag will run out in 5 minutes, or {} may be explicitly ungagged before then.",
        ),
        WeenieError::YourAllegianceChatPrivilegesRestoredBy => {
            Some("Your allegiance chat privileges have been restored by {}.")
        }
        WeenieError::YouRestoreAllegianceChatPrivilegesTo => {
            Some("You have restored allegiance chat privileges to {}.")
        }
        WeenieError::CowersFromYou => Some("{} cowers from you!"),
        _ => None,
    };

    // If we have a custom template, use it.
    if let Some(t) = template {
        let p = parameter.unwrap_or("Unknown");
        return t.replace("{}", p);
    }

    // Fallback: Convert the enum name "PascalCase" to "Sentence case"
    let variant_name = error.to_string();
    let mut sentence = String::new();
    for (i, c) in variant_name.chars().enumerate() {
        if i > 0 && c.is_uppercase() {
            sentence.push(' ');
            sentence.push(c.to_ascii_lowercase());
        } else {
            sentence.push(c);
        }
    }

    // Final polish for sentence ending
    if !sentence.ends_with('.') && !sentence.ends_with('!') && !sentence.ends_with('?') {
        sentence.push('.');
    }

    if let Some(p) = parameter {
        format!("{}: {}", sentence, p)
    } else {
        sentence
    }
}

pub fn format_weenie_error_id(error_id: u32, parameter: Option<&str>) -> String {
    if let Some(error) = WeenieError::from_repr(error_id) {
        format_weenie_error(error, parameter)
    } else {
        format!(
            "Unknown error {:#06X}{}",
            error_id,
            parameter.map(|p| format!(" ({})", p)).unwrap_or_default()
        )
    }
}

pub fn is_actually_weenie_error(err: WeenieError) -> bool {
    !matches!(
        err,
        WeenieError::YouHaveSucceededSpecializingSkill
            | WeenieError::YouHaveSucceededTransferringAttributes
            | WeenieError::YouHaveSucceededUntrainingSkill
            | WeenieError::TurbineChatIsEnabled
            | WeenieError::YouHaveLeftTheChannel
            | WeenieError::ITeleported
            | WeenieError::YouHaveEnteredTheChannel
            | WeenieError::CharacterNotAvailable
    )
}
