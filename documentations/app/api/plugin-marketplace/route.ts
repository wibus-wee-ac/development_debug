/*
 * Output: JSON representation of the documentation-owned Plugin Marketplace registry.
 * Input: Static marketplace entries from the documentation data module.
 * Position: Documentation API route for future Cradle desktop install discovery.
 */

import { getPluginMarketplacePayload } from '@/lib/plugin-marketplace';

export function GET() {
  return Response.json(getPluginMarketplacePayload());
}
