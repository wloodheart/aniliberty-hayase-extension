import { z } from "zod"

const scalarSchema = z.union([z.boolean(), z.number(), z.string()])
const permissionSchema = z.enum(["none", "read", "write"])
const permissionsSchema = z.record(z.string(), permissionSchema)

const stepSchema = z.strictObject({
  name: z.string().optional(),
  id: z.string().optional(),
  if: z.string().optional(),
  "continue-on-error": z.boolean().optional(),
  env: z.record(z.string(), scalarSchema).optional(),
  shell: z.string().optional(),
  "working-directory": z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), scalarSchema).optional(),
})

const jobSchema = z.strictObject({
  if: z.string().optional(),
  env: z.record(z.string(), scalarSchema).optional(),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  environment: z
    .union([z.string(), z.strictObject({ name: z.string(), url: z.string().optional() })])
    .optional(),
  "runs-on": z.string(),
  "timeout-minutes": z.number().positive().optional(),
  permissions: permissionsSchema.optional(),
  steps: z.array(stepSchema),
})

const triggerSchema = z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())])

export const WorkflowSchema = z.strictObject({
  name: z.string().min(1),
  on: triggerSchema,
  permissions: permissionsSchema,
  concurrency: z
    .strictObject({ group: z.string().min(1), "cancel-in-progress": z.literal(true) })
    .optional(),
  jobs: z.record(z.string(), jobSchema),
})

export type Workflow = z.infer<typeof WorkflowSchema>
export type WorkflowJob = z.infer<typeof jobSchema>
export type WorkflowPermissions = z.infer<typeof permissionsSchema>
export type WorkflowStep = z.infer<typeof stepSchema>
