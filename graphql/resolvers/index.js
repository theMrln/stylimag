const {
  User,
  Query: UserQuery,
  Mutation: UserMutation,
} = require('./userResolver')
const {
  Article,
  WorkingVersion,
  Query: ArticleQuery,
  Mutation: ArticleMutation,
} = require('./articleResolver')
const { Tag, Query: TagQuery, Mutation: TagMutation } = require('./tagResolver')
const {
  Version,
  Query: VersionQuery,
  Mutation: VersionMutation,
} = require('./versionResolver')
const {
  Workspace,
  Query: WorkspaceQuery,
  Mutation: WorkspaceMutation,
} = require('./workspaceResolver')
const {
  Corpus,
  Query: CorpusQuery,
  Mutation: CorpusMutation,
} = require('./corpusResolver')
const { Query: OjsQuery, Mutation: OjsMutation } = require('./ojsResolver')
const {
  Query: PipelineQuery,
  Mutation: PipelineMutation,
  PipelineJob,
  ExportArtifact,
} = require('./pipelineResolver')
const { Mutation: AuthMutation } = require('./authResolver')
const { InstanceUsageStats, Query: StatsQuery } = require('./statsResolver')
const {
  EmailAddressResolver,
  JWTResolver,
  HexColorCodeResolver,
  DateTimeResolver,
} = require('graphql-scalars')
const { GraphQLJSON, GraphQLJSONObject } = require('./jsonScalar.js')

module.exports = {
  // Custom Scalars
  JSON: GraphQLJSON,
  JSONObject: GraphQLJSONObject,
  EmailAddress: EmailAddressResolver,
  JWT: JWTResolver,
  HexColorCode: HexColorCodeResolver,
  DateTime: DateTimeResolver,

  // Types and Nested queries/mutations
  User,
  Article,
  Tag,
  Version,
  InstanceUsageStats,
  WorkingVersion,
  Workspace,
  Corpus,
  PipelineJob,
  ExportArtifact,
  // Root queries & mutations
  Query: {
    ...UserQuery,
    ...ArticleQuery,
    ...TagQuery,
    ...VersionQuery,
    ...StatsQuery,
    ...WorkspaceQuery,
    ...CorpusQuery,
    ...OjsQuery,
    ...PipelineQuery,
  },
  Mutation: {
    ...UserMutation,
    ...ArticleMutation,
    ...TagMutation,
    ...VersionMutation,
    ...AuthMutation,
    ...WorkspaceMutation,
    ...CorpusMutation,
    ...OjsMutation,
    ...PipelineMutation,
  },
}
