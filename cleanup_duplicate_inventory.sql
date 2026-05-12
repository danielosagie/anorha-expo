-- SQL to diagnose inventory level issues
-- Expected: 2 variants × 5 locations = 10 inventory levels for this product

-- 1. CHECK: How many inventory levels exist per variant?
SELECT 
    pv."Id" as variant_id,
    pv."Sku",
    pv."Title",
    pv."VariantType",
    pv."ProductId",
    COUNT(il."Id") as level_count,
    SUM(il."Quantity") as total_qty
FROM "ProductVariants" pv
LEFT JOIN "InventoryLevels" il ON il."ProductVariantId" = pv."Id"
WHERE pv."ProductId" = 'ff77c7f0-f004-4227-a0cb-0d53b8b05d59'  -- Your product ID from logs
GROUP BY pv."Id", pv."Sku", pv."Title", pv."VariantType", pv."ProductId"
ORDER BY pv."VariantType", pv."Title";

-- 2. CRITICAL: Find ORPHANED inventory levels (connection ID not in PlatformConnections)
SELECT 
    il."Id",
    il."ProductVariantId",
    il."PlatformConnectionId",
    il."PlatformLocationId",
    il."Quantity",
    CASE 
        WHEN pc."Id" IS NULL THEN '⚠️ ORPHANED - Connection deleted'
        ELSE '✅ Valid'
    END as status
FROM "InventoryLevels" il
LEFT JOIN "PlatformConnections" pc ON pc."Id" = il."PlatformConnectionId"
WHERE il."ProductVariantId" IN (
    SELECT "Id" FROM "ProductVariants" 
    WHERE "ProductId" = 'ff77c7f0-f004-4227-a0cb-0d53b8b05d59'
)
ORDER BY status DESC, il."ProductVariantId";

-- 3. CLEANUP: Delete orphaned inventory levels (connections that were deleted)
-- WARNING: Review query #2 first!
DELETE FROM "InventoryLevels"
WHERE "PlatformConnectionId" NOT IN (
    SELECT "Id" FROM "PlatformConnections"
);

-- 4. CHECK: What connections exist for your user?
SELECT 
    "Id",
    "PlatformType",
    "DisplayName",
    "IsEnabled"
FROM "PlatformConnections"
WHERE "UserId" = '003204d6-4da7-4666-9470-2c55b8d4d1df'  -- Your user ID from logs
ORDER BY "PlatformType";

-- 5. FINAL CHECK: After cleanup, verify inventory counts
SELECT 
    pv."Sku",
    pv."Title",
    pv."VariantType",
    COUNT(il."Id") as level_count,
    SUM(il."Quantity") as total_qty
FROM "ProductVariants" pv
LEFT JOIN "InventoryLevels" il ON il."ProductVariantId" = pv."Id"
WHERE pv."ProductId" = 'ff77c7f0-f004-4227-a0cb-0d53b8b05d59'
GROUP BY pv."Id", pv."Sku", pv."Title", pv."VariantType"
ORDER BY pv."VariantType", pv."Title";
