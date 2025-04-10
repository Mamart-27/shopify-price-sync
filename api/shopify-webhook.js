import axios from "axios";

const GRAPHQL_ENDPOINT = `https://${process.env.SHOPIFY_STORE_NAME}/admin/api/2023-10/graphql.json`;

async function graphqlRequest(query, variables = {}) {
  const res = await axios.post(
    GRAPHQL_ENDPOINT,
    { query, variables },
    {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    }
  );
  return res.data.data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const productId = req.body?.id;
  if (!productId) return res.status(400).send("Missing product ID");

  try {
    const productGID = `gid://shopify/Product/${productId}`;
    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          metafield(namespace: "custom", key: "base_price") {
            value
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      }
    `;

    const result = await graphqlRequest(query, { id: productGID });
    const basePrice = parseFloat(result.product.metafield?.value || 0);
    if (!basePrice) return res.status(200).send("No base price found.");

    const updates = result.product.variants.edges.map(({ node }) => {
      const match = node.title.match(/(\d+)\s*ml/i);
      if (!match) return null;
      const volume = parseFloat(match[1]);
      const calculatedPrice = ((volume / 500) * basePrice).toFixed(2);
      return `
        update${node.id.replace(/[^0-9]/g, "")}: productVariantUpdate(input: {
          id: "${node.id}",
          price: "${calculatedPrice}"
        }) {
          productVariant { id price }
          userErrors { field message }
        }
      `;
    }).filter(Boolean).join("\n");

    if (!updates) return res.status(200).send("No variants matched volume pattern");

    const mutation = `mutation { ${updates} }`;
    await graphqlRequest(mutation);

    return res.status(200).send("Variants updated successfully");
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(500).send("Server Error");
  }
}