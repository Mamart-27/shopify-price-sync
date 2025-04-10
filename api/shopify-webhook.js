const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const product = req.body;

  const fetchProductData = async (productId) => {
    try {
      const { data } = await axios.get(
        `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/products/${productId}.json`,
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          },
        }
      );
      return data.product;
    } catch (error) {
      console.error('Error fetching product data:', error.response?.data || error.message);
      throw new Error('Failed to fetch product data');
    }
  };

  const fetchProductMetafields = async (productId) => {
    try {
      const { data } = await axios.get(
        `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/products/${productId}/metafields.json`,
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          },
        }
      );
      return data.metafields;
    } catch (error) {
      console.error('Error fetching metafields:', error.response?.data || error.message);
      throw new Error('Failed to fetch product metafields');
    }
  };

  const extractVolumeKey = (title) => {
    const match = title.match(/([\d.]+)(ml|l)/i);
    if (!match) return null;

    const [_, amount, unit] = match;
    const normalizedUnit = unit.toLowerCase() === 'l' ? 'l' : 'ml';
    return `${amount}${normalizedUnit}_base_price`.toLowerCase();
  };

  const updateVariants = async (productData, metafields) => {
    for (const variant of productData.variants) {
      const volumeKey = extractVolumeKey(variant.title);

      if (!volumeKey) {
        console.warn(`Could not extract volume key from title: ${variant.title}`);
        continue;
      }

      const matchedMetafield = metafields.find(
        (mf) => mf.namespace === 'custom' && mf.key === volumeKey
      );

      if (!matchedMetafield) {
        console.warn(`Metafield ${volumeKey} not found for product`);
        continue;
      }

      const price = parseFloat(matchedMetafield.value);
      if (isNaN(price)) {
        console.warn(`Invalid price in metafield ${volumeKey}`);
        continue;
      }

      await axios.put(
        `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/variants/${variant.id}.json`,
        {
          variant: {
            id: variant.id,
            price: price.toFixed(2),
          },
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      );
    }
  };

  try {
    const productData = await fetchProductData(product.id);
    const metafields = await fetchProductMetafields(product.id);

    await updateVariants(productData, metafields);
    res.status(200).send('Variants updated successfully');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send('Failed to update variants');
  }
};
