// api/shopify-webhook.js

const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const product = req.body;

  // Function to fetch the latest product data
  const fetchProductData = async (productId) => {
    try {
      return await axios.get(
        `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/products/${productId}.json`,
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          },
        }
      );
    } catch (error) {
      console.error('Error fetching product data from Shopify:', error.response?.data || error.message);
      throw new Error('Failed to fetch the latest product data');
    }
  };

  // Function to update variants
  const updateVariants = async (productData) => {
    const baseVariant = productData.variants.find((v) => {
      const hasBasePriceMetafield = v.metafields?.some(
        (mf) => mf.namespace === 'product.custom' && mf.key === 'base_price'
      );
      return hasBasePriceMetafield || v.title.includes('1000ml');
    });

    if (!baseVariant) {
      throw new Error('Base variant not found');
    }

    const basePrice = parseFloat(baseVariant.price);

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
  };

  // First attempt to update
  let shopifyProduct;
  try {
    shopifyProduct = await fetchProductData(product.id);
    await updateVariants(shopifyProduct.data.product);
    return res.status(200).send('Variants updated successfully (First Run)');
  } catch (error) {
    console.error('Error during first run:', error.message);
  }

  // If first attempt failed or didn't update correctly, wait for a moment and try again
  console.log('Retrying the function (Second Run)...');
  await new Promise(resolve => setTimeout(resolve, 5000));  // 5-second delay (adjust as needed)

  try {
    shopifyProduct = await fetchProductData(product.id);
    await updateVariants(shopifyProduct.data.product);
    return res.status(200).send('Variants updated successfully (Second Run)');
  } catch (error) {
    console.error('Error during second run:', error.message);
    return res.status(500).send('Failed to update variants after retry');
  }
};
