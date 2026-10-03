-- Default-world settlement anchors. Read-only; MySQL 8 / MariaDB CTE + window functions.
-- Selection follows retail acclient.c:39016, plus Eastwatch and Westwatch.
-- POI aliases: Plateau, Qalabar, Fiun, Freehold, Outpost and Refuge are expanded below.
-- Candeth Keep (24579) and Wai Jhou (4218) use verified outdoor portal destinations directly.
-- Geographic/island labels are excluded. Crater Lake Village uses Silencia's outdoor placement.
-- WCID 2498 has TownName (PropertyString 24) = CraterLake; the four village vendors cluster
-- within six horizontal meters in landblock 90D0 (2497, 2498, 2499, 27554).
-- Town-named sign spawn positions are indoors and must not be used.
WITH selected AS (
    SELECT 'Ahurenga' AS name, 42827 AS portal_wcid
    UNION ALL
    SELECT 'Al-Arqas' AS name, 42823 AS portal_wcid
    UNION ALL
    SELECT 'Al-Jalima' AS name, 42830 AS portal_wcid
    UNION ALL
    SELECT 'Arwic' AS name, 42819 AS portal_wcid
    UNION ALL
    SELECT 'Ayan Baqur' AS name, 7194 AS portal_wcid
    UNION ALL
    SELECT 'Baishi' AS name, 42845 AS portal_wcid
    UNION ALL
    SELECT 'Bandit Castle' AS name, 1102 AS portal_wcid
    UNION ALL
    SELECT 'Bluespire' AS name, 42825 AS portal_wcid
    UNION ALL
    SELECT 'Candeth Keep' AS name, 24579 AS portal_wcid
    UNION ALL
    SELECT 'Cragstone' AS name, 42818 AS portal_wcid
    UNION ALL
    SELECT 'Danby''s Outpost' AS name, 43003 AS portal_wcid
    UNION ALL
    SELECT 'Dryreach' AS name, 42813 AS portal_wcid
    UNION ALL
    SELECT 'Eastham' AS name, 42815 AS portal_wcid
    UNION ALL
    SELECT 'Eastwatch' AS name, 42839 AS portal_wcid
    UNION ALL
    SELECT 'Fiun Outpost' AS name, 42999 AS portal_wcid
    UNION ALL
    SELECT 'Fort Tethana' AS name, 43001 AS portal_wcid
    UNION ALL
    SELECT 'Glenden Wood' AS name, 42814 AS portal_wcid
    UNION ALL
    SELECT 'Greenspire' AS name, 42826 AS portal_wcid
    UNION ALL
    SELECT 'Hebian-to' AS name, 42846 AS portal_wcid
    UNION ALL
    SELECT 'Holtburg' AS name, 42820 AS portal_wcid
    UNION ALL
    SELECT 'Kara' AS name, 42848 AS portal_wcid
    UNION ALL
    SELECT 'Khayyaban' AS name, 42822 AS portal_wcid
    UNION ALL
    SELECT 'Kryst' AS name, 42850 AS portal_wcid
    UNION ALL
    SELECT 'Lin' AS name, 42844 AS portal_wcid
    UNION ALL
    SELECT 'Linvak Tukal' AS name, 42838 AS portal_wcid
    UNION ALL
    SELECT 'Lytelthorpe' AS name, 42816 AS portal_wcid
    UNION ALL
    SELECT 'MacNiall''s Freehold' AS name, 43004 AS portal_wcid
    UNION ALL
    SELECT 'Mayoi' AS name, 42842 AS portal_wcid
    UNION ALL
    SELECT 'Nanto' AS name, 42843 AS portal_wcid
    UNION ALL
    SELECT 'Neydisa' AS name, 42828 AS portal_wcid
    UNION ALL
    SELECT 'Oolutanga''s Refuge' AS name, 43002 AS portal_wcid
    UNION ALL
    SELECT 'Plateau Village' AS name, 42812 AS portal_wcid
    UNION ALL
    SELECT 'Qalaba''r' AS name, 42833 AS portal_wcid
    UNION ALL
    SELECT 'Redspire' AS name, 42836 AS portal_wcid
    UNION ALL
    SELECT 'Rithwic' AS name, 42817 AS portal_wcid
    UNION ALL
    SELECT 'Samsur' AS name, 42834 AS portal_wcid
    UNION ALL
    SELECT 'Sanamar' AS name, 42835 AS portal_wcid
    UNION ALL
    SELECT 'Sawato' AS name, 42849 AS portal_wcid
    UNION ALL
    SELECT 'Shoushi' AS name, 42840 AS portal_wcid
    UNION ALL
    SELECT 'Silyun' AS name, 42998 AS portal_wcid
    UNION ALL
    SELECT 'Stonehold' AS name, 42811 AS portal_wcid
    UNION ALL
    SELECT 'Timaru' AS name, 43000 AS portal_wcid
    UNION ALL
    SELECT 'Tou-Tou' AS name, 42841 AS portal_wcid
    UNION ALL
    SELECT 'Tufa' AS name, 42829 AS portal_wcid
    UNION ALL
    SELECT 'Uziz' AS name, 42821 AS portal_wcid
    UNION ALL
    SELECT 'Wai Jhou' AS name, 4218 AS portal_wcid
    UNION ALL
    SELECT 'Westwatch' AS name, 42837 AS portal_wcid
    UNION ALL
    SELECT 'Xarabydun' AS name, 42832 AS portal_wcid
    UNION ALL
    SELECT 'Yanshi' AS name, 42847 AS portal_wcid
    UNION ALL
    SELECT 'Yaraq' AS name, 42824 AS portal_wcid
    UNION ALL
    SELECT 'Zaikhal' AS name, 42831 AS portal_wcid
), anchors AS (
    SELECT s.name, s.portal_wcid AS source_wcid, p.obj_Cell_Id AS cell_id,
           p.origin_X, p.origin_Y, p.origin_Z, 'portal' AS source_kind
    FROM selected s
    LEFT JOIN weenie w ON w.class_Id = s.portal_wcid AND w.type = 7
    LEFT JOIN weenie_properties_position p ON p.object_Id = w.class_Id AND p.position_Type = 2
    UNION ALL
    SELECT 'Crater Lake Village', 2498, l.obj_Cell_Id,
           l.origin_X, l.origin_Y, l.origin_Z, 'vendor'
    FROM (SELECT 2498 AS wcid) s
    LEFT JOIN weenie_properties_string town ON town.object_Id = s.wcid
        AND town.type = 24 AND town.value = 'CraterLake'
    LEFT JOIN landblock_instance l ON l.weenie_Class_Id = town.object_Id
)
SELECT name, source_wcid, LPAD(HEX(cell_id), 8, '0') AS cell_id,
       origin_X, origin_Y, origin_Z, COUNT(*) OVER () AS selected_count, source_kind
FROM anchors
ORDER BY name;
