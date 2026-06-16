import { z } from "zod";

export const ResourceRecordSchema = z
  .object({
    name: z.string().optional(),
    ttl: z.number().int().nonnegative().optional(),
    type: z.string(),
    value: z.string().optional(),
    pref: z.number().int().optional(),
    raw: z.string().optional()
  })
  .passthrough();

export const ZoneSchema = z
  .object({
    created: z.string().optional(),
    updated: z.string().optional(),
    origin: z.string(),
    idn: z.string().optional(),
    dnssec: z.boolean().optional(),
    nameServerGroup: z.string().optional(),
    comment: z.string().optional(),
    domainsafe: z.boolean().optional(),
    virtualNameServer: z.string().optional(),
    action: z.string().optional(),
    resourceRecords: z.array(ResourceRecordSchema).optional(),
    roid: z.number().int().optional()
  })
  .passthrough();

export const AutoDnsResponseSchema = z
  .object({
    stid: z.string().optional(),
    ctid: z.string().optional(),
    status: z
      .object({
        resultCode: z.string().optional(),
        text: z.string().optional(),
        type: z.string().optional()
      })
      .passthrough()
      .optional(),
    object: z.unknown().optional(),
    data: z.array(ZoneSchema)
  })
  .passthrough();

export type AutoDnsZone = z.infer<typeof ZoneSchema>;
export type AutoDnsResourceRecord = z.infer<typeof ResourceRecordSchema>;
export type AutoDnsZoneResponse = z.infer<typeof AutoDnsResponseSchema>;
