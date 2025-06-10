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

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;


const getMetafieldKey = (volumeKey) => `${volumeKey.replace('.', '_')}_base_price`;

const extractVolumeKey = (title) => {
  const match = title.toLowerCase().replace(/\s+/g, '').match(/([\d.]+)(ml|l)/);
  return match ? `${match[1]}${match[2]}` : null;
};

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

const addOrUpdateMetafield = async ({ productId, key, value, existingId = null }) => {
  const endpoint = existingId
    ? `https://${process.env.SHOP_DOMAIN}/admin/api/2025-04/metafields/${existingId}.json`
    : `https://${process.env.SHOP_DOMAIN}/admin/api/2025-04/products/${productId}/metafields.json`;

  const method = existingId ? 'put' : 'post';

  const payload = {
    metafield: {
      ...(existingId ? { id: existingId } : { namespace: 'custom', key }),
      type: 'number_decimal',
      value: Number(value).toFixed(2),
    },
  };

  await axios[method](endpoint, payload, {
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  console.log(`${existingId ? '🔁 Updated' : '➕ Created'} metafield ${key}: ${value}`);
};

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ message: 'Webhook is live' });
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const rawBody = await getRawBody(req);
    const product = JSON.parse(rawBody.toString('utf8'));

    console.log('🔔 Webhook triggered for product:', product.id);

    const productData = await fetchProductData(product.id);

    if (productData.product_type !== 'Fragrance Oil') {
      return res.status(200).send('Not Fragrance Oil – skipping');
    }

    const metafields = await fetchProductMetafields(product.id);

    for (const variant of productData.variants) {
      const volumeKey = extractVolumeKey(variant.title);
      if (!volumeKey || !VOLUME_MULTIPLIERS[volumeKey]) {
        console.log(`⏭️ Skipping variant: ${variant.title}`);
        continue;
      }

      const multiplier = VOLUME_MULTIPLIERS[volumeKey];
      const basePrice = parseFloat(variant.price) * multiplier;
      const metafieldKey = getMetafieldKey(volumeKey);

      const existing = metafields.find(
        (mf) => mf.namespace === 'custom' && mf.key === metafieldKey
      );

      await addOrUpdateMetafield({
        productId: product.id,
        key: metafieldKey,
        value: basePrice,
        existingId: existing?.id || null,
      });
    }

    res.status(200).send('Metafields updated from variant prices');
  } catch (error) {
    console.error('🔥 Sync failed:', error?.response?.data || error.message);
    res.status(500).send('Internal Server Error');
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
