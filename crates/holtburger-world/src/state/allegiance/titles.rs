//! Shared allegiance rank titles, distinct from configurable officer titles.
//! Tables match ACE Entity/AllegianceRank.cs; retail lookup is at acclient.c:461308.

/// Resolve a retail rank title from the wire heritage/gender codes and numeric rank.
/// Unknown codes and ranks outside 1–10 have no defined title.
pub fn rank_title(heritage: u8, gender: u8, rank: u16) -> Option<&'static str> {
    let titles = match heritage {
        1 => &ALUVIAN,
        2 => &GHARUNDIM,
        3 => &SHO,
        4 => &VIAMONTIAN,
        5 | 10 => &SHADOWBOUND,
        6 => &GEARKNIGHT,
        7 => &TUMEROK,
        8 => &LUGIAN,
        9 => &EMPYREAN,
        11 => &UNDEAD,
        _ => return None,
    };
    let &(male, female) = titles.get(usize::from(rank.checked_sub(1)?))?;
    match gender {
        1 => Some(male),
        2 => Some(female),
        _ => None,
    }
}

// Retail acclient.c:460390; ranks 1–10, male/female titles.
const ALUVIAN: [(&str, &str); 10] = [
    ("Yeoman", "Yeoman"),
    ("Baronet", "Baronet"),
    ("Baron", "Baroness"),
    ("Reeve", "Reeve"),
    ("Thane", "Thane"),
    ("Ealdor", "Ealdor"),
    ("Duke", "Duchess"),
    ("Aetheling", "Aetheling"),
    ("King", "Queen"),
    ("High King", "High Queen"),
];

// Retail acclient.c:460498; ranks 1–10, male/female titles.
const GHARUNDIM: [(&str, &str); 10] = [
    ("Sayyid", "Sayyida"),
    ("Shayk", "Shayka"),
    ("Maulan", "Maulana"),
    ("Mu'allim", "Mu'allima"),
    ("Naquib", "Naquiba"),
    ("Qadi", "Qadiya"),
    ("Mushir", "Mushira"),
    ("Amir", "Amira"),
    ("Malik", "Malika"),
    ("Sultan", "Sultana"),
];

// Retail acclient.c:460606; ranks 1–10, male/female titles.
const SHO: [(&str, &str); 10] = [
    ("Jinin", "Jinin"),
    ("Jo-chueh", "Jo-chueh"),
    ("Nan-chueh", "Nan-chueh"),
    ("Shi-chueh", "Shi-chueh"),
    ("Ta-chueh", "Ta-chueh"),
    ("Kun-chueh", "Kun-chueh"),
    ("Kou", "Kou"),
    ("Taikou", "Taikou"),
    ("Ou", "Jo-ou"),
    ("Koutei", "Koutei"),
];

// Retail acclient.c:460714; ranks 1–10, male/female titles.
const VIAMONTIAN: [(&str, &str); 10] = [
    ("Squire", "Dame"),
    ("Banner", "Banner"),
    ("Baron", "Baroness"),
    ("Viscount", "Viscountess"),
    ("Count", "Countess"),
    ("Marquis", "Marquise"),
    ("Duke", "Duchess"),
    ("Grand Duke", "Grand Duchess"),
    ("King", "Queen"),
    ("High King", "High Queen"),
];

// Retail acclient.c:460822; ranks 1–10, male/female titles.
const SHADOWBOUND: [(&str, &str); 10] = [
    ("Tenebrous", "Tenebrous"),
    ("Shade", "Shade"),
    ("Squire", "Squire"),
    ("Knight", "Knight"),
    ("Void Knight", "Void Knight"),
    ("Void Lord", "Void Lady"),
    ("Duke", "Duchess"),
    ("Archduke", "Archduchess"),
    ("Highborn", "Highborn"),
    ("King", "Queen"),
];

// Retail acclient.c:460930; ranks 1–10, male/female titles.
const GEARKNIGHT: [(&str, &str); 10] = [
    ("Tribunus", "Tribunus"),
    ("Praefectus", "Praefectus"),
    ("Optio", "Optio"),
    ("Centurion", "Centurion"),
    ("Principes", "Principes"),
    ("Legatus", "Legatus"),
    ("Consul", "Consul"),
    ("Dux", "Dux"),
    ("Secondus", "Secondus"),
    ("Primus", "Primus"),
];

// Retail acclient.c:460984; ranks 1–10, male/female titles.
const TUMEROK: [(&str, &str); 10] = [
    ("Xutua", "Xutua"),
    ("Tuona", "Tuona"),
    ("Ona", "Ona"),
    ("Nuona", "Nuona"),
    ("Turea", "Turea"),
    ("Rea", "Rea"),
    ("Nurea", "Nurea"),
    ("Kauh", "Kauh"),
    ("Sutah", "Sutah"),
    ("Tah", "Tah"),
];

// Retail acclient.c:461038; ranks 1–10, male/female titles.
const LUGIAN: [(&str, &str); 10] = [
    ("Laigus", "Laigus"),
    ("Raigus", "Raigus"),
    ("Amploth", "Amploth"),
    ("Arintoth", "Arintoth"),
    ("Obeloth", "Obeloth"),
    ("Lithos", "Lithos"),
    ("Kantos", "Kantos"),
    ("Gigas", "Gigas"),
    ("Extas", "Extas"),
    ("Tiatus", "Tiatus"),
];

// Retail acclient.c:461092; ranks 1–10, male/female titles.
const EMPYREAN: [(&str, &str); 10] = [
    ("Ensign", "Ensign"),
    ("Corporal", "Corporal"),
    ("Lieutenant", "Lieutenant"),
    ("Commander", "Commander"),
    ("Captain", "Captain"),
    ("Commodore", "Commodore"),
    ("Admiral", "Admiral"),
    ("Warlord", "Warlord"),
    ("Ipharsin", "Ipharsia"),
    ("Aulin", "Aulia"),
];

// Retail acclient.c:461200; ranks 1–10, male/female titles.
const UNDEAD: [(&str, &str); 10] = [
    ("Neophyte", "Neophyte"),
    ("Acolyte", "Acolyte"),
    ("Adept", "Adept"),
    ("Esquire", "Esquire"),
    ("Squire", "Squire"),
    ("Knight", "Knight"),
    ("Count", "Countess"),
    ("Viscount", "Viscountess"),
    ("Highness", "Highness"),
    ("Annointed", "Annointed"),
];
#[cfg(test)]
mod tests {
    use super::rank_title;

    #[test]
    fn allegiance_titles_follow_heritage_gender_and_rank() {
        for (heritage, male, female) in [
            (1, "High King", "High Queen"),
            (2, "Sultan", "Sultana"),
            (3, "Koutei", "Koutei"),
            (4, "High King", "High Queen"),
            (5, "King", "Queen"),
            (6, "Primus", "Primus"),
            (7, "Tah", "Tah"),
            (8, "Tiatus", "Tiatus"),
            (9, "Aulin", "Aulia"),
            (10, "King", "Queen"),
            (11, "Annointed", "Annointed"),
        ] {
            assert_eq!(rank_title(heritage, 1, 10), Some(male));
            assert_eq!(rank_title(heritage, 2, 10), Some(female));
            for gender in [1, 2] {
                for rank in 1..=10 {
                    assert!(rank_title(heritage, gender, rank).is_some());
                }
            }
        }
        assert_eq!(rank_title(1, 1, 3), Some("Baron"));
        assert_eq!(rank_title(1, 2, 3), Some("Baroness"));
        assert_eq!(rank_title(3, 2, 9), Some("Jo-ou"));
        assert_eq!(rank_title(5, 2, 6), Some("Void Lady"));
        for gender in [1, 2] {
            for rank in 1..=10 {
                assert_eq!(rank_title(5, gender, rank), rank_title(10, gender, rank));
            }
        }
    }

    #[test]
    fn allegiance_titles_leave_undefined_codes_and_ranks_absent() {
        for heritage in [0, 12, 13, u8::MAX] {
            assert_eq!(rank_title(heritage, 1, 1), None);
        }
        for gender in [0, 3, u8::MAX] {
            assert_eq!(rank_title(1, gender, 1), None);
        }
        for rank in [0, 11, u16::MAX] {
            assert_eq!(rank_title(1, 1, rank), None);
        }
    }
}
