import {z} from 'zod';
const stamp=z.string().max(100).refine(value=>Number.isFinite(Date.parse(value)));
export const supportTicketSnapshot=z.object({
 id:z.string().uuid(),ticketNo:z.string().max(100),subject:z.string().max(200),
 kind:z.enum(['problem','suggestion','order']),status:z.enum(['open','answered','closed']),
 name:z.string().max(300),email:z.string().max(320),phone:z.string().max(80),
 unread:z.boolean(),unanswered:z.boolean(),updatedAt:stamp,lastBody:z.string().max(4000),
 messageVersion:z.string().regex(/^[a-f0-9]{32}$/),messageCount:z.number().int().nonnegative(),
}).strict();
export const supportMessageSnapshot=z.object({id:z.string().uuid(),sender:z.enum(['customer','staff']),body:z.string().max(4000),createdAt:stamp,editedAt:stamp.nullable()}).strict();
export const supportTicketPage=z.object({tickets:z.array(supportTicketSnapshot).max(50),next:z.string().uuid().nullable()}).strict();
export const supportMessagePage=z.object({messages:z.array(supportMessageSnapshot).max(100),next:z.string().max(1000).nullable(),messageVersion:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
export type SupportTicketSnapshot=z.infer<typeof supportTicketSnapshot>;
export type SupportMessageSnapshot=z.infer<typeof supportMessageSnapshot>;
