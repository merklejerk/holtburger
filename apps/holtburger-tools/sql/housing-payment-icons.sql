-- Default-world housing payment artwork; read-only template reference data.
-- SlumLord.GetBuyItems/GetRentItems use DestinationType.HouseBuy (16) / HouseRent (32).
-- WeenieType.SlumLord=55; DID Icon=8, IconOverlay=50, IconUnderlay=52;
-- Int ItemType=1, UiEffects=18. NULL effects mean ACE's default mask of zero.
SELECT DISTINCT c.weenie_Class_Id, n.value AS name, icon.value AS icon,
    item_type.value AS item_type, COALESCE(effects.value, 0) AS ui_effects,
    overlay.value AS overlay, underlay.value AS underlay
FROM weenie_properties_create_list c
JOIN weenie w ON w.class_Id = c.object_Id
LEFT JOIN weenie_properties_string n ON n.object_Id = c.weenie_Class_Id AND n.type = 1
LEFT JOIN weenie_properties_d_i_d icon ON icon.object_Id = c.weenie_Class_Id AND icon.type = 8
LEFT JOIN weenie_properties_int item_type ON item_type.object_Id = c.weenie_Class_Id AND item_type.type = 1
LEFT JOIN weenie_properties_int effects ON effects.object_Id = c.weenie_Class_Id AND effects.type = 18
LEFT JOIN weenie_properties_d_i_d overlay ON overlay.object_Id = c.weenie_Class_Id AND overlay.type = 50
LEFT JOIN weenie_properties_d_i_d underlay ON underlay.object_Id = c.weenie_Class_Id AND underlay.type = 52
WHERE w.type = 55 AND (c.destination_Type & 48) <> 0
ORDER BY c.weenie_Class_Id;
