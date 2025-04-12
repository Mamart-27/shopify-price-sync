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
  const updateProductMetafield = async (metafieldId, newValue) => {
    try {
      const response = await axios.put(
        `https://${process.env.SHOP_DOMAIN}/admin/api/2025-04/metafields/${metafieldId}.json`,
        {
          metafield: {
            id: metafieldId,
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
      console.log("✅ Metafield Update:", response.metafield);
    } catch (error) {
      console.error("❌ Metafield update failed:", error.response.statusText || error.message);
    }
  };


  const addNewMetaFieldOnProduct = async (productId, value, namespace, key) => {
    try {
      const response = await axios.post(
        `https://${process.env.SHOP_DOMAIN}/admin/api/2025-04/products/${productId}/metafields.json`, 
        {
          metafield: {
            namespace: namespace,
            key: key,
            type: 'number_decimal',
            value: Number(value).toFixed(2),
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          }
        }
      );
      const metafieldId = response.metafield?.id;
      console.log("✅ Metafield Added:", metafieldId);
      return metafieldId;
    } catch (error) {
      console.error("❌ Metafield Add failed:", error.response.statusText || error.message);
      return null;
    }
  };


  // Extract the volume key from variant titles, such as "50ml", "100ml", "2.5l".
  const extractVolumeKey = (title) => {
    const match = title.toLowerCase().replace(/\s+/g, '').match(/([\d.]+)(ml|l)/);
    if (!match) return null;
    const [_, amount, unit] = match;
    return `${amount}${unit}`; // e.g., "50ml" or "2.5l"
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    const productData = await fetchProductData(product.id);

    console.warn(`Webhook executed from ${productData.title} - ${productData.id} | ${productData.product_type}`);

    if(productData.product_type !== 'Fragrance Oil') {
      console.warn(`Product type is not Fragrance Oil: ${productData.product_type}`);
      return res.status(200).send('Not a Fragrance Oil product, no sync needed');
    }

    let metafields = await fetchProductMetafields(product.id);

    for (const variant of productData.variants) {
      let isNewMetafield = false;
      const volumeKey = extractVolumeKey(variant.title);
      if (!volumeKey || !VOLUME_MULTIPLIERS[volumeKey]) continue;

      const multiplier = VOLUME_MULTIPLIERS[volumeKey];
      const metafieldKey = getMetafieldKey(volumeKey);

      let metafield = metafields.find(
        (mf) => mf.namespace === 'custom' && mf.key === metafieldKey
      );

      if (!metafield) {
        console.warn(`Missing metafield ${metafieldKey} | ${productData.title} for ${variant.title}, creating it...`);
        const newMetaId = await addNewMetaFieldOnProduct(product.id, 0, 'custom', metafieldKey);
        metafield = {
          id: newMetaId,
          namespace: 'custom',
          key: metafieldKey,
          value: parseFloat((0).toFixed(2))
        };
        isNewMetafield = true;
        await sleep(500);
      }

      const currentPrice = parseFloat(variant.price); // Current Price of the Product
      const currentBase = parseFloat(metafield.value); // Current Value of the base price meta field

      const rawPriceFromBase = currentBase / multiplier;
      const rawBaseFromPrice = currentPrice * multiplier;

      // Calculate price from base and base from price using the multiplier.
      const priceFromBase = parseFloat(rawPriceFromBase.toFixed(2));
      const baseFromPrice = parseFloat(rawBaseFromPrice.toFixed(2));

      // Check if there is a price mismatch and base mismatch.
      const priceMismatch = Math.abs(currentPrice - priceFromBase) > 0.01;
      const baseMismatch = Math.abs(currentBase - baseFromPrice) > 0.01;

      if(isNewMetafield){ 
        await updateProductMetafield(metafield.id, baseFromPrice);
        console.log(`Added Based Price for first time ${volumeKey} to ${baseFromPrice}`);
      } else if (priceMismatch && baseMismatch && !isNewMetafield) {// Both are off — prioritize base price as source of truth
        await updateVariantPrice(variant.id, priceFromBase);
        console.log(`Forced price sync for ${volumeKey} to ${priceFromBase}`);
      } else if (currentBase === 0 && priceMismatch && !isNewMetafield) {
        await updateProductMetafield(metafield.id, baseFromPrice);
        console.log(`Updated base price for ${volumeKey} to ${baseFromPrice}`);
      }
        else {
        console.log(`No update needed for ${volumeKey}`);
      }

      await sleep(300);
    }

    res.status(200).send('Sync complete');
  } catch (error) {
    console.error('Sync failed:', error.message);
    res.status(500).send('Sync failed');
  }
};
