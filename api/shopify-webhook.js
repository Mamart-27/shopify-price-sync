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

  const updateVariants = async (productData, basePrice) => {
    const updatedVariants = productData.variants.map((variant) => {
      let multiplier = 1;

      if (variant.title.includes('50ml')) multiplier = 0.05;
      else if (variant.title.includes('100ml')) multiplier = 0.1;
      else if (variant.title.includes('500ml')) multiplier = 0.5;
      else if (variant.title.includes('2.5L')) multiplier = 2.5;
      else if (variant.title.includes('5L')) multiplier = 5;
      else if (variant.title.includes('10L')) multiplier = 10;

      return {
        id: variant.id,
        price: (basePrice * multiplier).toFixed(2),
      };
    });

    for (const variant of updatedVariants) {
      await axios.put(
        `https://${process.env.SHOP_DOMAIN}/admin/api/2023-10/variants/${variant.id}.json`,
        { variant },
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

    const baseMetafield = metafields.find(
      (mf) => mf.namespace === 'custom' && mf.key === 'base_price'
    );

    if (!baseMetafield) {
      throw new Error('base_price metafield not found on product');
    }

    const basePrice = parseFloat(baseMetafield.value);

    if (isNaN(basePrice)) {
      throw new Error('Invalid base_price value');
    }

    await updateVariants(productData, basePrice);
    res.status(200).send('Variants updated successfully');
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send('Failed to update variants');
  }
};
