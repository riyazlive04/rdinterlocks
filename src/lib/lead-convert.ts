import { z } from "zod";
import { prisma } from "./db";

// The conversion transaction, kept out of the server action so it can be run
// (and tested) without a request context. The action layer adds auth,
// revalidation and the redirect; everything that touches data lives here.

export const convertSchema = z
  .object({
    // Either attach to an existing client, or create one from the lead.
    clientId: z.string().optional(),
    newClientName: z.string().optional(),
    newClientLocation: z.string().optional(),
    newClientPhone: z.string().optional(),
    // Optionally raise the first order at the same time.
    createOrder: z.boolean().default(false),
    brickSizeId: z.string().optional(),
    constructionTypeId: z.string().optional(),
    quantity: z.number().int().positive().optional(),
    pricePerBrick: z.number().nonnegative().optional(),
    expectedDeliveryDate: z.string().optional(),
  })
  .refine((d) => !!d.clientId || !!d.newClientName?.trim(), {
    message: "Pick an existing client or enter a name for a new one",
  })
  .refine(
    (d) =>
      !d.createOrder ||
      (!!d.brickSizeId && !!d.constructionTypeId && !!d.quantity && d.pricePerBrick !== undefined),
    { message: "An order needs brick size, construction type, quantity and price" }
  );

export type ConvertInput = z.infer<typeof convertSchema>;

/**
 * Turn a lead into a real customer.
 *
 * This is the write that makes the import endpoint's 409 reachable: once
 * convertedAt is set, further imports for the same callId are refused instead
 * of overwriting a record the office has already acted on.
 *
 * Returns the id of the client the lead is now attached to.
 */
export async function convertLeadCore(id: string, input: ConvertInput): Promise<string> {
  const p = convertSchema.parse(input);

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new Error("Lead not found");
  if (lead.convertedAt) throw new Error("This lead has already been converted.");

  // One transaction: either the client, the order and the conversion stamp all
  // land, or none of them do. A half-converted lead would be both editable by
  // import and attached to a live client.
  return prisma.$transaction(async (tx) => {
    let targetClientId = p.clientId;

    if (targetClientId) {
      const exists = await tx.client.findUnique({ where: { id: targetClientId } });
      if (!exists) throw new Error("The selected client no longer exists.");
    } else {
      const created = await tx.client.create({
        data: {
          name: (p.newClientName ?? "").trim(),
          location: p.newClientLocation?.trim() || null,
          phone: p.newClientPhone?.trim() || null,
          notes: lead.notes ? `From call ${lead.callId}: ${lead.notes}` : `From call ${lead.callId}`,
        },
      });
      targetClientId = created.id;
    }

    if (p.createOrder) {
      const quantity = p.quantity!;
      const price = p.pricePerBrick!;
      await tx.order.create({
        data: {
          clientId: targetClientId,
          date: new Date(),
          expectedDeliveryDate: p.expectedDeliveryDate ? new Date(p.expectedDeliveryDate) : null,
          notes: `Converted from lead ${lead.callId}`,
          items: {
            create: [
              {
                brickSizeId: p.brickSizeId!,
                constructionTypeId: p.constructionTypeId!,
                quantity,
                pricePerBrick: price,
                total: quantity * price,
              },
            ],
          },
        },
      });
    }

    // Guarded update: if a concurrent request converted this lead a moment ago,
    // convertedAt is no longer null and this matches zero rows, so the whole
    // transaction rolls back rather than producing a second client and order.
    const claimed = await tx.lead.updateMany({
      where: { id, convertedAt: null },
      data: {
        convertedClientId: targetClientId,
        convertedAt: new Date(),
        status: "converted",
        quotationStage: "won",
      },
    });
    if (claimed.count === 0) {
      throw new Error("This lead was converted by someone else a moment ago.");
    }

    return targetClientId;
  });
}
