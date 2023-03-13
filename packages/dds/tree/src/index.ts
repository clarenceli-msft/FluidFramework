/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

export {
	Dependee,
	Dependent,
	NamedComputation,
	ObservingDependent,
	InvalidationToken,
	recordDependency,
	SimpleDependee,
	EmptyKey,
	FieldKey,
	TreeType,
	Value,
	TreeValue,
	AnchorSet,
	DetachedField,
	UpPath,
	FieldUpPath,
	Anchor,
	RootField,
	ChildCollection,
	ChildLocation,
	FieldMapObject,
	NodeData,
	GenericTreeNode,
	JsonableTree,
	Delta,
	rootFieldKey,
	rootField,
	rootFieldKeySymbol,
	fieldSchema,
	FieldScope,
	GlobalFieldKeySymbol,
	symbolFromKey,
	keyFromSymbol,
	symbolIsFieldKey,
	isGlobalFieldKey,
	ITreeCursor,
	CursorLocationType,
	ITreeCursorSynchronous,
	GenericFieldsNode,
	AnchorLocator,
	TreeNavigationResult,
	IEditableForest,
	IForestSubscription,
	TreeLocation,
	FieldLocation,
	ForestLocation,
	ITreeSubscriptionCursor,
	ITreeSubscriptionCursorState,
	LocalFieldKey,
	GlobalFieldKey,
	TreeSchemaIdentifier,
	TreeSchemaBuilder,
	NamedTreeSchema,
	Named,
	FieldSchema,
	ValueSchema,
	TreeSchema,
	StoredSchemaRepository,
	FieldKindIdentifier,
	TreeTypeSet,
	SchemaData,
	SchemaPolicy,
	SchemaDataAndPolicy,
	ChangeEncoder,
	ChangeFamily,
	ChangeFamilyEditor,
	ProgressiveEditBuilder,
	ProgressiveEditBuilderBase,
	ChangeRebaser,
	FieldAnchor,
	RevisionTag,
	TaggedChange,
	RepairDataStore,
	ReadonlyRepairDataStore,
	SchemaEvents,
	ForestEvents,
	PathRootPrefix,
	AnchorKeyBrand,
	AnchorSlot,
	BrandedKey,
	BrandedKeyContent,
	BrandedMapSubset,
	AnchorNode,
	anchorSlot,
	UpPathDefault,
	AnchorEvents,
	FieldKindSpecifier,
} from "./core";

export {
	Brand,
	BrandedType,
	Opaque,
	extractFromOpaque,
	MakeNominal,
	Invariant,
	Contravariant,
	Covariant,
	ExtractFromOpaque,
	isAny,
	brand,
	brandOpaque,
	ValueFromBranded,
	NameFromBranded,
	JsonCompatibleReadOnly,
	JsonCompatible,
	JsonCompatibleObject,
	NestedMap,
	fail,
	TransactionResult,
} from "./util";

export {
	Events,
	IsEvent,
	ISubscribable,
	createEmitter,
	IEmitter,
	NoListenersCallback,
	HasListeners,
} from "./events";

export {
	cursorToJsonObject,
	singleJsonCursor,
	jsonArray,
	jsonBoolean,
	jsonNull,
	jsonNumber,
	jsonObject,
	jsonString,
	jsonSchemaData,
} from "./domains";

export {
	buildForest,
	ChangesetLocalId,
	emptyField,
	IdAllocator,
	neverTree,
	ModularChangeFamily,
	ModularChangeset,
	ModularEditBuilder,
	EditDescription,
	FieldChangeHandler,
	FieldEditor,
	FieldChangeRebaser,
	FieldChangeEncoder,
	NodeChangeset,
	ValueChange,
	FieldChangeMap,
	FieldChangeset,
	FieldChange,
	ToDelta,
	NodeReviver,
	NodeChangeComposer,
	NodeChangeInverter,
	NodeChangeRebaser,
	NodeChangeEncoder,
	NodeChangeDecoder,
	CrossFieldManager,
	CrossFieldTarget,
	RevisionIndexer,
	RevisionMetadataSource,
	RevisionInfo,
	FieldKind,
	Multiplicity,
	isNeverField,
	FullSchemaPolicy,
	UnwrappedEditableField,
	isUnwrappedNode,
	isEditableField,
	EditableTreeContext,
	UnwrappedEditableTree,
	EditableTreeOrPrimitive,
	EditableTree,
	EditableField,
	isPrimitiveValue,
	isPrimitive,
	getPrimaryField,
	typeSymbol,
	typeNameSymbol,
	valueSymbol,
	indexSymbol,
	proxyTargetSymbol,
	getField,
	createField,
	replaceField,
	ContextuallyTypedNodeDataObject,
	ContextuallyTypedNodeData,
	MarkedArrayLike,
	isWritableArrayLike,
	isContextuallyTypedNodeDataObject,
	defaultSchemaPolicy,
	jsonableTreeFromCursor,
	PrimitiveValue,
	IDefaultEditBuilder,
	ValueFieldEditBuilder,
	OptionalFieldEditBuilder,
	SequenceFieldEditBuilder,
	prefixPath,
	prefixFieldPath,
	singleTextCursor,
	namedTreeSchema,
	singleStackTreeCursor,
	CursorAdapter,
	CursorWithNode,
	parentField,
	ValueConstraint,
	TypedSchema,
	SchemaAware,
	ArrayLikeMut,
} from "./feature-libraries";

// Export subset of FieldKinds in an API-Extractor compatible way:
import {
	FieldEditor,
	FieldKind,
	FieldKinds as FieldKindsOriginal,
	Multiplicity,
} from "./feature-libraries";

/**
 * @alpha
 */
export const FieldKinds = {
	value: FieldKindsOriginal.value as FieldKind<FieldEditor<any>, Multiplicity.Value>,
	optional: FieldKindsOriginal.optional as FieldKind<FieldEditor<any>, Multiplicity.Optional>,
	sequence: FieldKindsOriginal.sequence as FieldKind<FieldEditor<any>, Multiplicity.Sequence>,
} as const;

export {
	ISharedTree,
	ISharedTreeCheckout,
	ISharedTreeCheckoutFork,
	runSynchronous,
	SharedTreeFactory,
} from "./shared-tree";

export { StableId, UuidString } from "./id-compressor";
