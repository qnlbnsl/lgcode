import * as Schema from "effect/Schema"

// Project identity and completion checks belong to the project piece.
// Optional fields keep existing questions and stored events readable.
export const QuestionMetadataFields = {
  title: Schema.optionalKey(Schema.String),
  recommendation: Schema.optionalKey(Schema.String),
  proposedAnswer: Schema.optionalKey(Schema.String),
  taskId: Schema.optionalKey(Schema.NonEmptyString),
  sprintId: Schema.optionalKey(Schema.NonEmptyString)
}
export const QuestionMetadata = Schema.Struct(QuestionMetadataFields)
export type QuestionMetadata = typeof QuestionMetadata.Type
