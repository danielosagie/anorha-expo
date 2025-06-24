-- Migration: Add Platform Boolean Columns to ProductVariants
-- This allows fast filtering without complex joins

ALTER TABLE "ProductVariants" 
ADD COLUMN "OnShopify" boolean NOT NULL DEFAULT false,
ADD COLUMN "OnSquare" boolean NOT NULL DEFAULT false,
ADD COLUMN "OnClover" boolean NOT NULL DEFAULT false,
ADD COLUMN "OnAmazon" boolean NOT NULL DEFAULT false,
ADD COLUMN "OnEbay" boolean NOT NULL DEFAULT false,
ADD COLUMN "OnFacebook" boolean NOT NULL DEFAULT false;

-- Add indexes for fast filtering
CREATE INDEX idx_productvariants_onshopify ON "ProductVariants"("OnShopify") WHERE "OnShopify" = true;
CREATE INDEX idx_productvariants_onsquare ON "ProductVariants"("OnSquare") WHERE "OnSquare" = true;
CREATE INDEX idx_productvariants_onclover ON "ProductVariants"("OnClover") WHERE "OnClover" = true;
CREATE INDEX idx_productvariants_onamazon ON "ProductVariants"("OnAmazon") WHERE "OnAmazon" = true;
CREATE INDEX idx_productvariants_onebay ON "ProductVariants"("OnEbay") WHERE "OnEbay" = true;
CREATE INDEX idx_productvariants_onfacebook ON "ProductVariants"("OnFacebook") WHERE "OnFacebook" = true;

-- Composite index for multiple platform filtering
CREATE INDEX idx_productvariants_platforms ON "ProductVariants"("OnShopify", "OnSquare", "OnClover", "OnAmazon", "OnEbay", "OnFacebook");

-- Update existing records based on current mappings
UPDATE "ProductVariants" 
SET "OnShopify" = true 
WHERE "Id" IN (
    SELECT DISTINCT ppm."ProductVariantId" 
    FROM "PlatformProductMappings" ppm
    JOIN "PlatformConnections" pc ON ppm."PlatformConnectionId" = pc."Id"
    WHERE LOWER(pc."PlatformType") = 'shopify' AND ppm."IsEnabled" = true
);

UPDATE "ProductVariants" 
SET "OnSquare" = true 
WHERE "Id" IN (
    SELECT DISTINCT ppm."ProductVariantId" 
    FROM "PlatformProductMappings" ppm
    JOIN "PlatformConnections" pc ON ppm."PlatformConnectionId" = pc."Id"
    WHERE LOWER(pc."PlatformType") = 'square' AND ppm."IsEnabled" = true
);

UPDATE "ProductVariants" 
SET "OnClover" = true 
WHERE "Id" IN (
    SELECT DISTINCT ppm."ProductVariantId" 
    FROM "PlatformProductMappings" ppm
    JOIN "PlatformConnections" pc ON ppm."PlatformConnectionId" = pc."Id"
    WHERE LOWER(pc."PlatformType") = 'clover' AND ppm."IsEnabled" = true
);

UPDATE "ProductVariants" 
SET "OnAmazon" = true 
WHERE "Id" IN (
    SELECT DISTINCT ppm."ProductVariantId" 
    FROM "PlatformProductMappings" ppm
    JOIN "PlatformConnections" pc ON ppm."PlatformConnectionId" = pc."Id"
    WHERE LOWER(pc."PlatformType") = 'amazon' AND ppm."IsEnabled" = true
);

UPDATE "ProductVariants" 
SET "OnEbay" = true 
WHERE "Id" IN (
    SELECT DISTINCT ppm."ProductVariantId" 
    FROM "PlatformProductMappings" ppm
    JOIN "PlatformConnections" pc ON ppm."PlatformConnectionId" = pc."Id"
    WHERE LOWER(pc."PlatformType") = 'ebay' AND ppm."IsEnabled" = true
);

UPDATE "ProductVariants" 
SET "OnFacebook" = true 
WHERE "Id" IN (
    SELECT DISTINCT ppm."ProductVariantId" 
    FROM "PlatformProductMappings" ppm
    JOIN "PlatformConnections" pc ON ppm."PlatformConnectionId" = pc."Id"
    WHERE LOWER(pc."PlatformType") = 'facebook' AND ppm."IsEnabled" = true
); 