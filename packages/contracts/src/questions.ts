import * as Schema from "effect/Schema"
import { ProjectId, SprintId, TaskId } from "./project/schema.ts"

// Project identity and completion checks belong to the project piece.
// Optional fields keep existing questions and stored events readable.
export const ProjectRequestLinkFields = {
  projectId: Schema.optionalKey(ProjectId),
  taskId: Schema.optionalKey(TaskId),
  sprintId: Schema.optionalKey(SprintId)
}
export type ProjectRequestLink = { readonly projectId?: typeof ProjectId.Type; readonly taskId?: typeof TaskId.Type; readonly sprintId?: typeof SprintId.Type }
export const QuestionMetadataFields = {
  ...ProjectRequestLinkFields,
  title: Schema.optionalKey(Schema.String),
  recommendation: Schema.optionalKey(Schema.String),
  proposedAnswer: Schema.optionalKey(Schema.String)
}
export const QuestionMetadata = Schema.Struct(QuestionMetadataFields)
export type QuestionMetadata = typeof QuestionMetadata.Type
