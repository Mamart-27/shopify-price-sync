const axios = require('axios');
const getRawBody = require('raw-body');

// Volume multipliers
const VOLUME_MULTIPLIERS = {
  '50ml': 20,
  '100ml': 10,
  '500ml': 2,
  '1000ml': 1,
  '2.5l': 0.4,
  '5l': 0.2,
  '10l': 0.1,
};

// Helper functions
const getMetafieldKey = (volumeKey) => `${volumeKey.replace('.', '_')}_base_price`;

const extractVolumeKey = (title) => {
  const match = title.toLowerCase().replace(/\s+/g, '').match(/([\d.]+)(ml|l)/);
  if (!match) return null;
  return `${match[1]}${match[2]}`;
};

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ message: 'Webhook endpoint is live' });
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // Get raw body from Shopify
    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody.toString('utf8'));
    const product = body;
    const SHOP_DOMAIN='scent-method.myshopify.com';
    const SHOPIFY_ACCESS_TOKEN='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';


    console.log('🔔 Webhook triggered');
    console.log('📦 Product ID:', product.id);


    // Fetch full product details
    const fetchProductData = async (productId) => {
      const { data } = await axios.get(
        `https://${SHOP_DOMAIN}/admin/api/2025-04/products/${productId}.json`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          },
        }
      );
      return data.product;
    };

    const fetchProductMetafields = async (productId) => {
      const { data } = await axios.get(
        `https://${SHOP_DOMAIN}/admin/api/2025-04/products/${productId}/metafields.json`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          },
        }
      );
      return data.metafields;
    };

    // const updateVariantPrice = async (variantId, newPrice) => {
    //   await axios.put(
    //     `https://${SHOP_DOMAIN}/admin/api/2025-04/variants/${variantId}.json`,
    //     { variant: { id: variantId, price: newPrice.toFixed(2) } },
    //     {
    //       headers: {
    //         'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    //         'Content-Type': 'application/json',
    //       },
    //     }
    //   );
    //   console.log(`💸 Updated variant ${variantId} price to ${newPrice}`);
    // };

    const updateProductMetafield = async (metafieldId, newValue) => {
      try {
        await axios.put(
          `https://${SHOP_DOMAIN}/admin/api/2025-04/metafields/${metafieldId}.json`,
          {
            metafield: {
              id: metafieldId,
              value: Number(newValue).toFixed(2),
            },
          },
          {
            headers: {
              'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
              'Content-Type': 'application/json',
            },
          }
        );
        console.log("✅ Metafield updated");
      } catch (error) {
        console.error("❌ Metafield update failed:", error?.response?.data || error.message);
      }
    };

    const addNewMetaFieldOnProduct = async (productId, value, namespace, key) => {
      try {
        await axios.post(
          `https://${SHOP_DOMAIN}/admin/api/2025-04/products/${productId}/metafields.json`,
          {
            metafield: {
              namespace: namespace,
              key: key,
              type: 'number_decimal',
              value: Number(value).toFixed(2),
            },
          },
          {
            headers: {
              'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
              'Content-Type': 'application/json',
            },
          }
        );
        console.log("✅ Metafield added");
      } catch (error) {
        console.error("❌ Metafield add failed:", error?.response?.data || error.message);
      }
    };

    const productData = await fetchProductData(product.id);

    console.log(`🎯 Processing: ${productData.title} (${productData.product_type})`);

    if (productData.product_type !== 'Fragrance Oil') {
      console.log('⚠️ Skipping non-Fragrance Oil product');
      return res.status(200).send('Skipped - Not Fragrance Oil');
    }

    const metafields = await fetchProductMetafields(product.id);

    for (const variant of productData.variants) {
      const volumeKey = extractVolumeKey(variant.title);
      if (!volumeKey || !VOLUME_MULTIPLIERS[volumeKey]) {
        console.log(`⛔ Skipping variant: ${variant.title}`);
        continue;
      }

      const multiplier = VOLUME_MULTIPLIERS[volumeKey];
      const metafieldKey = getMetafieldKey(volumeKey);

      let metafield = metafields.find(
        (mf) => mf.namespace === 'custom' && mf.key === metafieldKey
      );

      if (!metafield) {
        console.log(`🆕 Creating metafield ${metafieldKey}`);
        await addNewMetaFieldOnProduct(product.id, 0, 'custom', metafieldKey);
        continue; // Skip for now
      }

      const currentPrice = parseFloat(variant.price);
      const currentBase = parseFloat(metafield.value);

      const priceFromBase = parseFloat((currentBase / multiplier).toFixed(2));
      const baseFromPrice = parseFloat((currentPrice * multiplier).toFixed(2));

      const priceMismatch = Math.abs(currentPrice - priceFromBase) > 0.01;
      const baseMismatch = Math.abs(currentBase - baseFromPrice) > 0.01;

      if (currentBase === 0) {
        await updateProductMetafield(metafield.id, baseFromPrice);
      } else if (priceMismatch && baseMismatch) {
        await updateVariantPrice(variant.id, priceFromBase);
      } else {
        console.log(`✅ ${volumeKey}: No update needed`);
      }
    }

    res.status(200).send('Sync complete');
  } catch (error) {
    console.error('🔥 Sync failed:', error.message);
    res.status(500).send('Internal Server Error');
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
