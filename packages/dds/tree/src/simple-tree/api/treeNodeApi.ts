/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { assert, oob } from "@fluidframework/core-utils/internal";

import { EmptyKey, rootFieldKey } from "../../core/index.js";
import {
	type LazyItem,
	type TreeStatus,
	isLazy,
	isTreeValue,
	FlexObjectNodeSchema,
	isMapTreeNode,
	FieldKinds,
} from "../../feature-libraries/index.js";
import { fail, extractFromOpaque, isReadonlyArray } from "../../util/index.js";

import { getOrCreateNodeFromFlexTreeNode } from "../proxies.js";
import { getOrCreateInnerNode } from "../proxyBinding.js";
import {
	type TreeLeafValue,
	type ImplicitFieldSchema,
	FieldSchema,
	type ImplicitAllowedTypes,
	type TreeNodeFromImplicitAllowedTypes,
} from "../schemaTypes.js";
import {
	booleanSchema,
	handleSchema,
	nullSchema,
	numberSchema,
	stringSchema,
} from "../leafNodeSchema.js";
import { isFluidHandle } from "@fluidframework/runtime-utils/internal";
import { UsageError } from "@fluidframework/telemetry-utils/internal";
import type { Off } from "../../events/index.js";
import {
	getKernel,
	isTreeNode,
	type TreeNodeSchema,
	NodeKind,
	type TreeNode,
	type TreeChangeEvents,
	tryGetTreeNodeSchema,
} from "../core/index.js";
import { isObjectNodeSchema } from "../objectNodeTypes.js";

/**
 * Provides various functions for analyzing {@link TreeNode}s.
 * * @remarks
 * This type should only be used via the public `Tree` export.
 * @privateRemarks
 * Due to limitations of API-Extractor link resolution, this type can't be moved into internalTypes but should be considered just an implementation detail of the `Tree` export.
 *
 * Inlining the typing of this interface onto the `Tree` object provides slightly different .d.ts generation,
 * which avoids typescript expanding the type of TreeNodeSchema and thus encountering
 * https://github.com/microsoft/rushstack/issues/1958.
 * @sealed @public
 */
export interface TreeNodeApi {
	/**
	 * The schema information for this node.
	 */
	schema(node: TreeNode | TreeLeafValue): TreeNodeSchema;

	/**
	 * Narrow the type of the given value if it satisfies the given schema.
	 * @example
	 * ```ts
	 * if (node.is(myNode, Point)) {
	 *     const y = myNode.y; // `myNode` is now known to satisfy the `Point` schema and therefore has a `y` coordinate.
	 * }
	 * ```
	 */
	is<TSchema extends ImplicitAllowedTypes>(
		value: unknown,
		schema: TSchema,
	): value is TreeNodeFromImplicitAllowedTypes<TSchema>;

	/**
	 * Return the node under which this node resides in the tree (or undefined if this is a root node of the tree).
	 */
	parent(node: TreeNode): TreeNode | undefined;

	/**
	 * The key of the given node under its parent.
	 * @remarks
	 * If `node` is an element in a {@link (TreeArrayNode:interface)}, this returns the index of `node` in the array node (a `number`).
	 * Otherwise, this returns the key of the field that it is under (a `string`).
	 */
	key(node: TreeNode): string | number;

	/**
	 * Register an event listener on the given node.
	 * @param node - The node whose events should be subscribed to.
	 * @param eventName - Which event to subscribe to.
	 * @param listener - The callback to trigger for the event. The tree can be read during the callback, but it is invalid to modify the tree during this callback.
	 * @returns A callback function which will deregister the event.
	 * This callback should be called only once.
	 */
	on<K extends keyof TreeChangeEvents>(
		node: TreeNode,
		eventName: K,
		listener: TreeChangeEvents[K],
	): () => void;

	/**
	 * Returns the {@link TreeStatus} of the given node.
	 */
	status(node: TreeNode): TreeStatus;

	/**
	 * Returns the {@link SchemaFactory.identifier | identifier} of the given node in the most compressed form possible.
	 * @remarks
	 * If the node's identifier is a valid UUID that was automatically generated by the SharedTree, then this will return a process-unique integer corresponding to that identifier.
	 * Note that the node must already have been inserted into the tree in order to retrieve a generated UUID (or shortId will error).
	 * This is useful for performance-sensitive scenarios involving many nodes with identifiers that need to be compactly retained in memory or used for efficient lookup.
	 *
	 * If the node's identifier is any other user-provided string, then this will return that string.
	 *
	 * If the node has no identifier (that is, it has no {@link SchemaFactory.identifier | identifier} field), then this returns `undefined`.
	 *
	 * If the node has more than one identifier, then this will throw an error.
	 *
	 * The returned integer must not be serialized or preserved outside of the current process.
	 * Its lifetime is that of the current in-memory instance of the FF container for this client, and it is not guaranteed to be unique or stable outside of that context.
	 * The same node's identifier may, for example, be different across multiple sessions for the same client and document, or different across two clients in the same session.
	 */
	shortId(node: TreeNode): number | string | undefined;
}

/**
 * The `Tree` object holds various functions for analyzing {@link TreeNode}s.
 */
export const treeNodeApi: TreeNodeApi = {
	parent(node: TreeNode): TreeNode | undefined {
		const editNode = getOrCreateInnerNode(node).parentField.parent.parent;
		if (editNode === undefined) {
			return undefined;
		}

		const output = getOrCreateNodeFromFlexTreeNode(editNode);
		assert(
			!isTreeValue(output),
			0x87f /* Parent can't be a leaf, so it should be a node not a value */,
		);
		return output;
	},
	key(node: TreeNode): string | number {
		// If the parent is undefined, then this node is under the root field,
		// so we know its key is the special root one.
		const parent = treeNodeApi.parent(node);
		if (parent === undefined) {
			return rootFieldKey;
		}

		// The flex-domain strictly operates in terms of "stored keys".
		// To find the associated developer-facing "property key", we need to look up the field associated with
		// the stored key from the flex-domain, and get property key its simple-domain counterpart was created with.
		const storedKey = getStoredKey(node);
		const parentSchema = treeNodeApi.schema(parent);
		const propertyKey = getPropertyKeyFromStoredKey(parentSchema, storedKey);
		return propertyKey;
	},
	on<K extends keyof TreeChangeEvents>(
		node: TreeNode,
		eventName: K,
		listener: TreeChangeEvents[K],
	): Off {
		const kernel = getKernel(node);
		switch (eventName) {
			case "nodeChanged": {
				const nodeSchema = kernel.schema;
				if (isObjectNodeSchema(nodeSchema)) {
					return kernel.on("childrenChangedAfterBatch", ({ changedFields }) => {
						const changedProperties = new Set(
							Array.from(
								changedFields,
								(field) =>
									nodeSchema.storedKeyToPropertyKey.get(field) ??
									fail(`Could not find stored key '${field}' in schema.`),
							),
						);
						listener({ changedProperties });
					});
				} else if (nodeSchema.kind === NodeKind.Array) {
					return kernel.on("childrenChangedAfterBatch", () => {
						listener({ changedProperties: undefined });
					});
				} else {
					return kernel.on("childrenChangedAfterBatch", ({ changedFields }) => {
						listener({ changedProperties: changedFields });
					});
				}
			}
			case "treeChanged": {
				return kernel.on("subtreeChangedAfterBatch", () => listener({}));
			}
			default:
				throw new UsageError(`No event named ${JSON.stringify(eventName)}.`);
		}
	},
	status(node: TreeNode): TreeStatus {
		return getKernel(node).getStatus();
	},
	is<TSchema extends ImplicitAllowedTypes>(
		value: unknown,
		schema: TSchema,
	): value is TreeNodeFromImplicitAllowedTypes<TSchema> {
		const actualSchema = tryGetSchema(value);
		if (actualSchema === undefined) {
			return false;
		}
		if (isReadonlyArray<LazyItem<TreeNodeSchema>>(schema)) {
			for (const singleSchema of schema) {
				const testSchema = isLazy(singleSchema) ? singleSchema() : singleSchema;
				if (testSchema === actualSchema) {
					return true;
				}
			}
			return false;
		} else {
			// Linter is incorrect about this bering unnecessary: it does not compile without the type assertion.
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
			return (schema as TreeNodeSchema) === actualSchema;
		}
	},
	schema(node: TreeNode | TreeLeafValue): TreeNodeSchema {
		return tryGetSchema(node) ?? fail("Not a tree node");
	},
	shortId(node: TreeNode): number | string | undefined {
		const flexNode = getOrCreateInnerNode(node);
		const flexSchema = flexNode.flexSchema;
		const identifierFieldKeys =
			flexSchema instanceof FlexObjectNodeSchema ? flexSchema.identifierFieldKeys : [];

		switch (identifierFieldKeys.length) {
			case 0:
				return undefined;
			case 1: {
				const identifier = flexNode.tryGetField(identifierFieldKeys[0] ?? oob())?.boxedAt(0);
				if (isMapTreeNode(flexNode)) {
					if (identifier === undefined) {
						throw new UsageError(
							"Tree.shortId cannot access default identifiers on unhydrated nodes",
						);
					}
					return identifier.value as string;
				}
				assert(identifier?.context.isHydrated() === true, "Expected hydrated identifier");
				const identifierValue = identifier.value as string;

				const localNodeKey =
					identifier.context.nodeKeyManager.tryLocalizeNodeKey(identifierValue);
				return localNodeKey !== undefined ? extractFromOpaque(localNodeKey) : identifierValue;
			}
			default:
				throw new UsageError(
					"shortId() may not be called on a node with more than one identifier. Consider converting extraneous identifier fields to string fields.",
				);
		}
	},
};

/**
 * Returns a schema for a value if the value is a {@link TreeNode} or a {@link TreeLeafValue}.
 * Returns undefined for other values.
 */
export function tryGetSchema(value: unknown): undefined | TreeNodeSchema {
	switch (typeof value) {
		case "string":
			return stringSchema;
		case "number":
			return numberSchema;
		case "boolean":
			return booleanSchema;
		case "object": {
			if (isTreeNode(value)) {
				// TODO: This case could be optimized, for example by placing the simple schema in a symbol on tree nodes.
				return tryGetTreeNodeSchema(value);
			}
			if (value === null) {
				return nullSchema;
			}
			if (isFluidHandle(value)) {
				return handleSchema;
			}
		}
		default:
			return undefined;
	}
}

/**
 * Gets the stored key with which the provided node is associated in the parent.
 */
function getStoredKey(node: TreeNode): string | number {
	// Note: the flex domain strictly works with "stored keys", and knows nothing about the developer-facing
	// "property keys".
	const parentField = getOrCreateInnerNode(node).parentField;
	if (parentField.parent.schema.kind === FieldKinds.sequence.identifier) {
		// The parent of `node` is an array node
		assert(
			parentField.parent.key === EmptyKey,
			"When using index as key, field should use EmptyKey",
		);
		return parentField.index;
	}

	// The parent of `node` is an object, a map, or undefined. If undefined, then `node` is a root/detached node.
	assert(parentField.index === 0, "When using field key as key, index should be 0");
	return parentField.parent.key;
}

/**
 * Given a node schema, gets the property key corresponding with the provided {@link FieldProps.key | stored key}.
 */
function getPropertyKeyFromStoredKey(
	schema: TreeNodeSchema,
	storedKey: string | number,
): string | number {
	// Only object nodes have the concept of a "stored key", differentiated from the developer-facing "property key".
	// For any other kind of node, the stored key and the property key are the same.
	if (schema.kind !== NodeKind.Object) {
		return storedKey;
	}

	const fields = schema.info as Record<string, ImplicitFieldSchema>;

	// Invariants:
	// - The set of all property keys under an object must be unique.
	// - The set of all stored keys (including those implicitly created from property keys) must be unique.
	// To find the property key associated with the provided stored key, first check for any stored key matches (which are optionally populated).
	// If we don't find any, then search for a matching property key.
	for (const [propertyKey, fieldSchema] of Object.entries(fields)) {
		if (fieldSchema instanceof FieldSchema && fieldSchema.props?.key === storedKey) {
			return propertyKey;
		}
	}

	if (fields[storedKey] === undefined) {
		fail("Existing stored key should always map to a property key");
	}

	return storedKey;
}
