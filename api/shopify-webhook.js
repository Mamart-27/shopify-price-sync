const axios = require('axios');

// Define volume multipliers for each variant size.
const VOLUME_MULTIPLIERS = {
  '50ml': 20, // 50ml base price multiplied by 20 for the actual price of 1000ml.
  '100ml': 10, // 100ml base price multiplied by 10 for the actual price of 1000ml.
  '500ml': 2,  // 500ml base price multiplied by 2 for the actual price of 1000ml.
  '1000ml': 1, // 1000ml base price stays the same.
  '2.5l': 0.4, // 2.5L base price divided by 0.4 for the actual price of 1000ml.
  '5l': 0.2,   // 5L base price divided by 0.2 for the actual price of 1000ml.
  '10l': 0.1,  // 10L base price divided by 0.1 for the actual price of 1000ml.
};

// Function to derive the metafield key for each volume variant.
const getMetafieldKey = (volumeKey) => {
  return `${volumeKey.replace('.', '_')}_base_price`;
};

// Main function to process the product variants and update prices.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const product = req.body;

  // Fetch product data from Shopify Admin API.
  const fetchProductData = async (productId) => {
    const { data } = await axios.get(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2025-04/products/${productId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        },
      }
    );
    return data.product;
  };

  // Fetch product metafields.
  const fetchProductMetafields = async (productId) => {
    const { data } = await axios.get(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2025-04/products/${productId}/metafields.json`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        },
      }
    );
    return data.metafields;
  };

  // Update the price of a variant in Shopify.
  const updateVariantPrice = async (variantId, newPrice) => {
    await axios.put(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2025-04/variants/${variantId}.json`,
      {
        variant: { id: variantId, price: newPrice.toFixed(2) },
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );
  };

  // Update a product's metafield in Shopify.
  const updateProductMetafield = async (metafield, newValue) => {
    await axios.put(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2025-04/metafields/${metafieldId.id}.json`,
      {
        metafield: {
          id: metafield.id,
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value: Number(newValue).toFixed(2),
        },
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );
  };

  // Extract the volume key from variant titles, such as "50ml", "100ml", "2.5l".
  const extractVolumeKey = (title) => {
    const match = title.toLowerCase().replace(/\s+/g, '').match(/([\d.]+)(ml|l)/);
    if (!match) return null;
    const [_, amount, unit] = match;
    return `${amount}${unit}`; // e.g., "50ml" or "2.5l"
  };

  try {
    const productData = await fetchProductData(product.id);
    const metafields = await fetchProductMetafields(product.id);

    for (const variant of productData.variants) {
      const volumeKey = extractVolumeKey(variant.title);
      if (!volumeKey || !VOLUME_MULTIPLIERS[volumeKey]) continue;

      const multiplier = VOLUME_MULTIPLIERS[volumeKey];
      const metafieldKey = getMetafieldKey(volumeKey);

      const metafield = metafields.find(
        (mf) => mf.namespace === 'custom' && mf.key === metafieldKey
      );

      if (!metafield) {
        console.warn(`Missing metafield "${metafieldKey}" for ${variant.title}`);
        continue;
      }

      const currentPrice = parseFloat(variant.price); // Current Price of the Product
      const currentBase = parseFloat(metafield.value); // Current Value of the base price meta field

      // Calculate price from base and base from price using the multiplier.
      const priceFromBase = parseFloat((currentBase / multiplier).toFixed(2));
      const baseFromPrice = parseFloat((currentPrice * multiplier).toFixed(2));

      // Check if there is a price mismatch and base mismatch.
      const priceMismatch = Math.abs(currentPrice - priceFromBase) > 0.01;
      const baseMismatch = Math.abs(currentBase - baseFromPrice) > 0.01;

      if (priceMismatch && !baseMismatch) {
        // Update price to match base
        await updateVariantPrice(variant.id, priceFromBase);
        console.log(`Updated price for ${volumeKey} to ${priceFromBase}`);
      } else if (!currentBase && priceMismatch) {
        // Update base to match price
        await updateProductMetafield(metafield, baseFromPrice);
        console.log(`Updated base price for ${volumeKey} to ${baseFromPrice}`);
      } else if (priceMismatch && baseMismatch) {
        // Both are off — prioritize base price as source of truth
        await updateVariantPrice(variant.id, priceFromBase);
        console.log(`Forced price sync for ${volumeKey} to ${priceFromBase}`);
      } else {
        console.log(`No update needed for ${volumeKey}`);
      }


      await updateProductMetafield(metafield, baseFromPrice);

    }

    res.status(200).send('Sync complete');
  } catch (error) {
    console.error('Sync failed:', error.message);
    res.status(500).send('Sync failed');
  }
};
