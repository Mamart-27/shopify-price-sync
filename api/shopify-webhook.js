import { buffer } from 'micro';
import axios from 'axios';

export const config = {
  api: {
    bodyParser: false,
  },
};

// Keep your volume multipliers, helper functions, etc. here (unchanged)
const VOLUME_MULTIPLIERS = {
  '50ml': 20,
  '100ml': 10,
  '500ml': 2,
  '1000ml': 1,
  '2.5l': 0.4,
  '5l': 0.2,
  '10l': 0.1,
};

const getMetafieldKey = (volumeKey) => `${volumeKey.replace('.', '_')}_base_price`;

// Start of main handler
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const rawBody = await buffer(req);
    const product = JSON.parse(rawBody.toString());

    // your fetch/update functions can stay the same as you had them

    // (PASTE all your existing logic here — except the first `module.exports` line, remove that)

    // Fetch product data, metafields, etc.
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

    const updateProductMetafield = async (metafieldId, newValue) => {
      try {
        await axios.put(
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
        console.log("✅ Metafield Updated Successfully");
      } catch (error) {
        console.error("❌ Metafield update failed:", error.response?.statusText || error.message);
      }
    };

    const addNewMetaFieldOnProduct = async (productId, value, namespace, key) => {
      try {
        await axios.post(
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
        console.log("✅ Metafield Added Successfully");
      } catch (error) {
        console.error("❌ Metafield Add failed:", error.response?.statusText || error.message);
      }
    };

    const extractVolumeKey = (title) => {
      const match = title.toLowerCase().replace(/\s+/g, '').match(/([\d.]+)(ml|l)/);
      if (!match) return null;
      const [_, amount, unit] = match;
      return `${amount}${unit}`;
    };

    // Main Logic
    const productData = await fetchProductData(product.id);
    console.warn(`Webhook executed from ${productData.title} - ${productData.id} | ${productData.product_type}`);

    if (productData.product_type !== 'Fragrance Oil') {
      console.warn(`Product type is not Fragrance Oil: ${productData.product_type}`);
      return res.status(200).send('Not a Fragrance Oil product, no sync needed');
    }

    let metafields = await fetchProductMetafields(product.id);

    for (const variant of productData.variants) {
      const volumeKey = extractVolumeKey(variant.title);
      if (!volumeKey || !VOLUME_MULTIPLIERS[volumeKey]) continue;

      const multiplier = VOLUME_MULTIPLIERS[volumeKey];
      const metafieldKey = getMetafieldKey(volumeKey);

      let metafield = metafields.find(
        (mf) => mf.namespace === 'custom' && mf.key === metafieldKey
      );

      if (!metafield) {
        console.warn(`Missing metafield ${metafieldKey} | ${productData.title} for ${variant.title}, creating it...`);
        await addNewMetaFieldOnProduct(product.id, 0, 'custom', metafieldKey);
        continue;
      }

      const currentPrice = parseFloat(variant.price);
      const currentBase = parseFloat(metafield.value);

      const rawPriceFromBase = currentBase / multiplier;
      const rawBaseFromPrice = currentPrice * multiplier;

      const priceFromBase = parseFloat(rawPriceFromBase.toFixed(2));
      const baseFromPrice = parseFloat(rawBaseFromPrice.toFixed(2));

      const priceMismatch = Math.abs(currentPrice - priceFromBase) > 0.01;
      const baseMismatch = Math.abs(currentBase - baseFromPrice) > 0.01;

      if (currentBase === 0) {
        await updateProductMetafield(metafield.id, baseFromPrice);
        console.log(`Updated base price for ${volumeKey} to ${baseFromPrice}`);
      } else if (priceMismatch && baseMismatch) {
        await updateVariantPrice(variant.id, priceFromBase);
        console.log(`Variant price sync for ${volumeKey} to ${priceFromBase}`);
      } else {
        console.log(`No update needed for ${volumeKey}`);
      }
    }

    res.status(200).send('Sync complete');

  } catch (err) {
    console.error('Sync failed:', err.message);
    res.status(500).send('Sync failed');
  }
}
