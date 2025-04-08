// api/shopify-webhook.js

const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const product = req.body;

  // Find the base variant (e.g., 1000ml)
  const baseVariant = product.variants.find(
    (v) => v.title.includes('1000ml') // or use SKU or metafield
  );

  if (!baseVariant) {
    return res.status(200).send('Base variant not found.');
  }

  const basePrice = parseFloat(baseVariant.price);

  // Define logic for other variant prices
  const updatedVariants = product.variants.map((variant) => {
    if (variant.id === baseVariant.id) return null;

    let multiplier = 1;

    if (variant.title.includes('500ml')) multiplier = 0.6;
    if (variant.title.includes('2000ml')) multiplier = 1.8;

    return {
      id: variant.id,
      price: (basePrice * multiplier).toFixed(2),
    };
  }).filter(Boolean);

  try {
    // Update each variant using Shopify Admin API
    for (const variant of updatedVariants) {
      await axios.put(
        `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/variants/${variant.id}.json`,
        {
          variant: { id: variant.id, price: variant.price },
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    return res.status(200).send('Variants updated');
  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).send('Failed to update variants');
  }
};
