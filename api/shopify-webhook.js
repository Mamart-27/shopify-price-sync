const axios = require('axios');

const VOLUME_MULTIPLIERS = {
  '50ml': 20,
  '100ml': 10,
  '500ml': 2,
  '1000ml': 1,
  '2.5l': 0.4,
  '5l': 0.2,
  '10l': 0.1,
};


module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const product = req.body;

  const fetchProductData = async (productId) => {
    const { data } = await axios.get(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/products/${productId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        },
      }
    );
    return data.product;
  };

  const fetchProductMetafields = async (productId) => {
    const { data } = await axios.get(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/products/${productId}/metafields.json`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        },
      }
    );
    return data.metafields;
  };

  const updateVariantPrice = async (variantId, newPrice) => {
    await axios.put(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/variants/${variantId}.json`,
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

  const updateProductMetafield = async (productId, metafieldId, newValue) => {
    await axios.put(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/metafields/${metafieldId}.json`,
      {
        metafield: {
          id: metafieldId,
          value: newValue.toFixed(2),
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

  const extractVolumeKey = (title) => {
    const match = title.toLowerCase().replace(/\s+/g, '').match(/([\d.]+)(ml|l)/);
    if (!match) return null;
    const [_, amount, unit] = match;
    return `${amount}${unit}`; // e.g., "2.5l"
  };
  

  try {
    const productData = await fetchProductData(product.id);
    const metafields = await fetchProductMetafields(product.id);

    for (const variant of productData.variants) {
      const volumeKey = extractVolumeKey(variant.title);
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

      const currentPrice = parseFloat(variant.price);
      const currentBase = parseFloat(metafield.value);

      // const priceFromBase = parseFloat((currentBase * ratio).toFixed(2));
      // const baseFromPrice = parseFloat((currentPrice / ratio).toFixed(2));
      const priceFromBase = parseFloat((currentBase / ratio).toFixed(2));
      const baseFromPrice = parseFloat((currentPrice * ratio).toFixed(2));


      const priceMismatch = Math.abs(currentPrice - priceFromBase) > 0.01;
      const baseMismatch = Math.abs(currentBase - baseFromPrice) > 0.01;

      if (priceMismatch && !baseMismatch) {
        // Update price to match base
        await updateVariantPrice(variant.id, priceFromBase);
        console.log(`Updated price for ${volumeKey} to ${priceFromBase}`);
      } else if (!priceMismatch && baseMismatch) {
        // Update base to match price
        await updateProductMetafield(product.id, metafield.id, baseFromPrice);
        console.log(`Updated base price for ${volumeKey} to ${baseFromPrice}`);
      } else if (priceMismatch && baseMismatch) {
        // Both are off — prioritize base price as source of truth
        await updateVariantPrice(variant.id, priceFromBase);
        console.log(`Forced price sync for ${volumeKey} to ${priceFromBase}`);
      } else {
        console.log(`No update needed for ${volumeKey}`);
      }
    }

    res.status(200).send('Sync complete');
  } catch (error) {
    console.error('Sync failed:', error.message);
    res.status(500).send('Sync failed');
  }
};
