// api/shopify-webhook.js

const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const product = req.body;

  // Delay to ensure Shopify's internal processes have updated the price
  // await new Promise(resolve => setTimeout(resolve, 5000));  // 5-second delay (adjust as needed)

  // Fetch the current product data from Shopify to get the latest prices
  let shopifyProduct;
  try {
    shopifyProduct = await axios.get(
      `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/products/${product.id}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        },
      }
    );
  } catch (error) {
    console.error('Error fetching product data from Shopify:', error.response?.data || error.message);
    return res.status(500).send('Failed to fetch the latest product data');
  }

  const productData = shopifyProduct.data.product;

  // Find the base variant (e.g., 1000ml)
  const baseVariant = productData.variants.find((v) => {
    // Check if the variant has the base_price metafield
    const hasBasePriceMetafield = v.metafields?.some(
      (mf) => mf.namespace === 'product.custom' && mf.key === 'base_price'
    );

    // You can keep the title check as a fallback or remove it entirely
    return hasBasePriceMetafield || v.title.includes('1000ml');
  });

  if (!baseVariant) {
    return res.status(200).send('Base variant not found.');
  }

  const basePrice = parseFloat(baseVariant.price);

  // Define logic for other variant prices
  const updatedVariants = productData.variants.map((variant) => {
    if (variant.id === baseVariant.id) return null;

    let multiplier = 1;

    if (variant.title.includes('50ml')) multiplier = 0.05;
    if (variant.title.includes('100ml')) multiplier = 0.1;
    if (variant.title.includes('500ml')) multiplier = 0.5;
    if (variant.title.includes('2.5L')) multiplier = 2.5;
    if (variant.title.includes('5L')) multiplier = 5;
    if (variant.title.includes('10L')) multiplier = 10;

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
