/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { IFluidHandle } from "@fluidframework/core-interfaces";
import { IFluidSerializer, ValueType } from "@fluidframework/shared-object-base";
import { assert, TypedEventEmitter } from "@fluidframework/common-utils";
import { ISequencedDocumentMessage } from "@fluidframework/protocol-definitions";
import { AttributionKey } from "@fluidframework/runtime-definitions";
import { IMapOptions, ISerializableValue, ISerializedValue, ISharedMapEvents } from "./interfaces";
import {
	IMapSetOperation,
	IMapDeleteOperation,
	IMapClearOperation,
	IMapKeyEditLocalOpMetadata,
	IMapKeyAddLocalOpMetadata,
	IMapClearLocalOpMetadata,
} from "./internalInterfaces";
import { ILocalValue, LocalValueMaker, makeSerializable } from "./localValues";

/**
 * Defines the means to process and submit a given op on a map.
 */
interface IMapMessageHandler {
	/**
	 * Apply the given operation.
	 * @param message - The message to process
	 * @param local - Whether the message originated from the local client
	 * @param localOpMetadata - For local client messages, this is the metadata that was submitted with the message.
	 * For messages from a remote client, this will be undefined.
	 */
	process(
		message: ISequencedDocumentMessage,
		local: boolean,
		localOpMetadata: MapLocalOpMetadata,
	): void;

	/**
	 * Communicate the operation to remote clients.
	 * @param op - The map operation to submit
	 * @param localOpMetadata - The metadata to be submitted with the message.
	 */
	submit(op: IMapOperation, localOpMetadata: MapLocalOpMetadata): void;

	applyStashedOp(op: IMapOperation): MapLocalOpMetadata;
}

/**
 * Map key operations are one of several types.
 */
export type IMapKeyOperation = IMapSetOperation | IMapDeleteOperation;

/**
 * Description of a map delta operation
 */
export type IMapOperation = IMapKeyOperation | IMapClearOperation;

/**
 * Defines the in-memory object structure to be used for the conversion to/from serialized.
 *
 * @remarks Directly used in
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify
 * | JSON.stringify}, direct result from
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse | JSON.parse}.
 */
export interface IMapDataObjectSerializable {
	[key: string]: ISerializableValue;
}

/**
 * Serialized key/value data.
 */
export interface IMapDataObjectSerialized {
	[key: string]: ISerializedValue;
}

type MapKeyLocalOpMetadata = IMapKeyEditLocalOpMetadata | IMapKeyAddLocalOpMetadata;
type MapLocalOpMetadata = IMapClearLocalOpMetadata | MapKeyLocalOpMetadata;

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */

function isMapKeyLocalOpMetadata(metadata: any): metadata is MapKeyLocalOpMetadata {
	return (
		metadata !== undefined &&
		typeof metadata.pendingMessageId === "number" &&
		(metadata.type === "add" || metadata.type === "edit")
	);
}

function isClearLocalOpMetadata(metadata: any): metadata is IMapClearLocalOpMetadata {
	return (
		metadata !== undefined &&
		metadata.type === "clear" &&
		typeof metadata.pendingMessageId === "number"
	);
}

function isMapLocalOpMetadata(metadata: any): metadata is MapLocalOpMetadata {
	return (
		metadata !== undefined &&
		typeof metadata.pendingMessageId === "number" &&
		(metadata.type === "add" || metadata.type === "edit" || metadata.type === "clear")
	);
}

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */

function createClearLocalOpMetadata(
	op: IMapClearOperation,
	pendingClearMessageId: number,
	previousMap?: Map<string, ILocalValue>,
): IMapClearLocalOpMetadata {
	const localMetadata: IMapClearLocalOpMetadata = {
		type: "clear",
		pendingMessageId: pendingClearMessageId,
		previousMap,
	};
	return localMetadata;
}

function createKeyLocalOpMetadata(
	op: IMapKeyOperation,
	pendingMessageId: number,
	previousValue?: ILocalValue,
): MapKeyLocalOpMetadata {
	const localMetadata: MapKeyLocalOpMetadata = previousValue
		? { type: "edit", pendingMessageId, previousValue }
		: { type: "add", pendingMessageId };
	return localMetadata;
}

/**
 * A SharedMap is a map-like distributed data structure.
 */
export class MapKernel {
	/**
	 * The number of key/value pairs stored in the map.
	 */
	public get size(): number {
		return this.data.size;
	}

	/**
	 * Mapping of op types to message handlers.
	 */
	private readonly messageHandlers: ReadonlyMap<string, IMapMessageHandler> = new Map();

	/**
	 * The in-memory data the map is storing.
	 */
	private readonly data = new Map<string, ILocalValue>();

	/**
	 * Keys that have been modified locally but not yet ack'd from the server.
	 */
	private readonly pendingKeys: Map<string, number[]> = new Map();

	/**
	 * This is used to assign a unique id to every outgoing operation and helps in tracking unack'd ops.
	 */
	private pendingMessageId: number = -1;

	/**
	 * The pending ids of any clears that have been performed locally but not yet ack'd from the server
	 */
	private readonly pendingClearMessageIds: number[] = [];

	/**
	 * Object to create encapsulations of the values stored in the map.
	 */
	private readonly localValueMaker: LocalValueMaker;

	private readonly attribution: Map<string, AttributionKey> | undefined;

	/**
	 * Create a new shared map kernel.
	 * @param serializer - The serializer to serialize / parse handles
	 * @param handle - The handle of the shared object using the kernel
	 * @param submitMessage - A callback to submit a message through the shared object
	 * @param isAttached - To query whether the shared object should generate ops
	 * @param valueTypes - The value types to register
	 * @param eventEmitter - The object that will emit map events
	 */
	public constructor(
		private readonly serializer: IFluidSerializer,
		private readonly handle: IFluidHandle,
		private readonly submitMessage: (op: unknown, localOpMetadata: unknown) => void,
		private readonly isAttached: () => boolean,
		private readonly eventEmitter: TypedEventEmitter<ISharedMapEvents>,
		private readonly options?: IMapOptions,
	) {
		this.localValueMaker = new LocalValueMaker(serializer);
		this.messageHandlers = this.getMessageHandlers();
		if (options?.attribution?.track) {
			this.attribution = new Map();
		}
	}

	/**
	 * Get an iterator over the keys in this map.
	 * @returns The iterator
	 */
	public keys(): IterableIterator<string> {
		return this.data.keys();
	}

	/**
	 * Get an iterator over the entries in this map.
	 * @returns The iterator
	 */
	// TODO: Use `unknown` instead (breaking change).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public entries(): IterableIterator<[string, any]> {
		const localEntriesIterator = this.data.entries();
		const iterator = {
			next(): IteratorResult<[string, unknown]> {
				const nextVal = localEntriesIterator.next();
				return nextVal.done
					? { value: undefined, done: true }
					: // Unpack the stored value
					  { value: [nextVal.value[0], nextVal.value[1].value], done: false };
			},
			[Symbol.iterator](): IterableIterator<[string, unknown]> {
				return this;
			},
		};
		return iterator;
	}

	/**
	 * Get an iterator over the values in this map.
	 * @returns The iterator
	 */
	// TODO: Use `unknown` instead (breaking change).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public values(): IterableIterator<any> {
		const localValuesIterator = this.data.values();
		const iterator = {
			next(): IteratorResult<unknown> {
				const nextVal = localValuesIterator.next();
				return nextVal.done
					? { value: undefined, done: true }
					: // Unpack the stored value
					  { value: nextVal.value.value as unknown, done: false };
			},
			[Symbol.iterator](): IterableIterator<unknown> {
				return this;
			},
		};
		return iterator;
	}

	/**
	 * Get an iterator over the entries in this map.
	 * @returns The iterator
	 */
	// TODO: Use `unknown` instead (breaking change).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public [Symbol.iterator](): IterableIterator<[string, any]> {
		return this.entries();
	}

	/**
	 * Executes the given callback on each entry in the map.
	 * @param callbackFn - Callback function
	 */
	public forEach(
		callbackFn: (value: unknown, key: string, map: Map<string, unknown>) => void,
	): void {
		// eslint-disable-next-line unicorn/no-array-for-each
		this.data.forEach((localValue, key, m) => {
			callbackFn(localValue.value, key, m);
		});
	}

	/**
	 * {@inheritDoc ISharedMap.get}
	 */
	// TODO: Use `unknown` instead (breaking change).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public get<T = any>(key: string): T | undefined {
		const localValue = this.data.get(key);
		return localValue === undefined ? undefined : (localValue.value as T);
	}

	/**
	 * Check if a key exists in the map.
	 * @param key - The key to check
	 * @returns True if the key exists, false otherwise
	 */
	public has(key: string): boolean {
		return this.data.has(key);
	}

	/**
	 * {@inheritDoc ISharedMap.set}
	 */
	public set(key: string, value: unknown): void {
		// Undefined/null keys can't be serialized to JSON in the manner we currently snapshot.
		if (key === undefined || key === null) {
			throw new Error("Undefined and null keys are not supported");
		}

		// Create a local value and serialize it.
		const localValue = this.localValueMaker.fromInMemory(value);
		const serializableValue = makeSerializable(localValue, this.serializer, this.handle);

		// Set the value locally.
		const previousValue = this.setCore(key, localValue, true);

		// If we are not attached, don't submit the op.
		if (!this.isAttached()) {
			return;
		}

		const op: IMapSetOperation = {
			key,
			type: "set",
			value: serializableValue,
		};
		this.submitMapKeyMessage(op, previousValue);
	}

	/**
	 * Delete a key from the map.
	 * @param key - Key to delete
	 * @returns True if the key existed and was deleted, false if it did not exist
	 */
	public delete(key: string): boolean {
		// Delete the key locally first.
		const previousValue = this.deleteCore(key, true);

		// If we are not attached, don't submit the op.
		if (!this.isAttached()) {
			return previousValue !== undefined;
		}

		const op: IMapDeleteOperation = {
			key,
			type: "delete",
		};
		this.submitMapKeyMessage(op, previousValue);

		return previousValue !== undefined;
	}

	/**
	 * Clear all data from the map.
	 */
	public clear(): void {
		const copy = this.isAttached() ? new Map<string, ILocalValue>(this.data) : undefined;

		// Clear the data locally first.
		this.clearCore(true);

		// If we are not attached, don't submit the op.
		if (!this.isAttached()) {
			return;
		}

		const op: IMapClearOperation = {
			type: "clear",
		};
		this.submitMapClearMessage(op, copy);
	}

	/**
	 * Get the attribution about the target key
	 * @param key - Key to track
	 * @returns The Attribution Key if the attribution tracking is enabled and key exists, otherwise undefined
	 * @alpha
	 */
	public getAttribution(key: string): AttributionKey | undefined {
		return this.attribution?.get(key);
	}

	/**
	 * Get the whole attribution table
	 * @returns The attribution table if the attribution tracking is enabled, otherwise undefined
	 * @alpha
	 */

	public getAllAttribution(): Map<string, AttributionKey> | undefined {
		return this.attribution;
	}

	private setAttribution(message: ISequencedDocumentMessage, key: string): void {
		if (this.options?.attribution?.track ?? false) {
			this.attribution?.set(key, { type: "op", seq: message.sequenceNumber });
		}
	}

	private clearAttribution(): void {
		if (this.options?.attribution?.track ?? false) {
			this.attribution?.clear();
		}
	}

	/**
	 * Serializes the data stored in the shared map to a JSON string
	 * @param serializer - The serializer to use to serialize handles in its values.
	 * @returns A JSON string containing serialized map data
	 */
	public getSerializedStorage(serializer: IFluidSerializer): IMapDataObjectSerialized {
		const serializableMapData: IMapDataObjectSerialized = {};
		for (const [key, localValue] of this.data.entries()) {
			const track = this.options?.attribution?.track;
			serializableMapData[key] = localValue.makeSerialized(
				serializer,
				this.handle,
				track ? this.attribution?.get(key) : undefined,
			);
		}
		return serializableMapData;
	}

	public getSerializableStorage(serializer: IFluidSerializer): IMapDataObjectSerializable {
		const serializableMapData: IMapDataObjectSerializable = {};
		for (const [key, localValue] of this.data.entries()) {
			serializableMapData[key] = makeSerializable(localValue, serializer, this.handle);
		}
		return serializableMapData;
	}

	public serialize(serializer: IFluidSerializer): string {
		return JSON.stringify(this.getSerializableStorage(serializer));
	}

	/**
	 * Populate the kernel with the given map data.
	 * @param json - A JSON string containing serialized map data
	 */
	public populateFromSerializable(json: IMapDataObjectSerializable): void {
		for (const [key, serializable] of Object.entries(json)) {
			const localValue = {
				key,
				value: this.makeLocal(key, serializable),
			};

			this.data.set(localValue.key, localValue.value);
			if (serializable.attribution) {
				this.attribution?.set(localValue.key, serializable.attribution);
			}
		}
	}

	public populate(json: string): void {
		this.populateFromSerializable(JSON.parse(json) as IMapDataObjectSerializable);
	}

	/**
	 * Submit the given op if a handler is registered.
	 * @param op - The operation to attempt to submit
	 * @param localOpMetadata - The local metadata associated with the op. This is kept locally by the runtime
	 * and not sent to the server. This will be sent back when this message is received back from the server. This is
	 * also sent if we are asked to resubmit the message.
	 * @returns True if the operation was submitted, false otherwise.
	 */
	public trySubmitMessage(op: IMapOperation, localOpMetadata: unknown): boolean {
		const handler = this.messageHandlers.get(op.type);
		if (handler === undefined) {
			return false;
		}
		handler.submit(op, localOpMetadata as MapLocalOpMetadata);
		return true;
	}

	public tryApplyStashedOp(op: IMapOperation): unknown {
		const handler = this.messageHandlers.get(op.type);
		if (handler === undefined) {
			throw new Error("no apply stashed op handler");
		}
		return handler.applyStashedOp(op);
	}

	/**
	 * Process the given op if a handler is registered.
	 * @param message - The message to process
	 * @param local - Whether the message originated from the local client
	 * @param localOpMetadata - For local client messages, this is the metadata that was submitted with the message.
	 * For messages from a remote client, this will be undefined.
	 * @returns True if the operation was processed, false otherwise.
	 */
	public tryProcessMessage(
		message: ISequencedDocumentMessage,
		local: boolean,
		localOpMetadata: unknown,
	): boolean {
		const op: IMapOperation = message.contents;
		const handler = this.messageHandlers.get(op.type);
		if (handler === undefined) {
			return false;
		}
		handler.process(message, local, localOpMetadata as MapLocalOpMetadata);
		return true;
	}

	/* eslint-disable @typescript-eslint/no-unsafe-member-access */

	/**
	 * Rollback a local op
	 * @param op - The operation to rollback
	 * @param localOpMetadata - The local metadata associated with the op.
	 */
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
	public rollback(op: any, localOpMetadata: unknown): void {
		if (!isMapLocalOpMetadata(localOpMetadata)) {
			throw new Error("Invalid localOpMetadata");
		}

		if (op.type === "clear" && localOpMetadata.type === "clear") {
			if (localOpMetadata.previousMap === undefined) {
				throw new Error("Cannot rollback without previous map");
			}
			for (const [key, localValue] of localOpMetadata.previousMap.entries()) {
				this.setCore(key, localValue, true);
			}

			const lastPendingClearId = this.pendingClearMessageIds.pop();
			if (
				lastPendingClearId === undefined ||
				lastPendingClearId !== localOpMetadata.pendingMessageId
			) {
				throw new Error("Rollback op does match last clear");
			}
		} else if (op.type === "delete" || op.type === "set") {
			if (localOpMetadata.type === "add") {
				this.deleteCore(op.key as string, true);
			} else if (
				localOpMetadata.type === "edit" &&
				localOpMetadata.previousValue !== undefined
			) {
				this.setCore(op.key as string, localOpMetadata.previousValue, true);
			} else {
				throw new Error("Cannot rollback without previous value");
			}

			const pendingMessageIds = this.pendingKeys.get(op.key as string);
			const lastPendingMessageId = pendingMessageIds?.pop();
			if (!pendingMessageIds || lastPendingMessageId !== localOpMetadata.pendingMessageId) {
				throw new Error("Rollback op does not match last pending");
			}
			if (pendingMessageIds.length === 0) {
				this.pendingKeys.delete(op.key as string);
			}
		} else {
			throw new Error("Unsupported op for rollback");
		}
	}

	/* eslint-enable @typescript-eslint/no-unsafe-member-access */

	/**
	 * Set implementation used for both locally sourced sets as well as incoming remote sets.
	 * @param key - The key being set
	 * @param value - The value being set
	 * @param local - Whether the message originated from the local client
	 * @returns Previous local value of the key, if any
	 */
	private setCore(key: string, value: ILocalValue, local: boolean): ILocalValue | undefined {
		const previousLocalValue = this.data.get(key);
		const previousValue: unknown = previousLocalValue?.value;
		this.data.set(key, value);
		this.eventEmitter.emit("valueChanged", { key, previousValue }, local, this.eventEmitter);
		return previousLocalValue;
	}

	/**
	 * Clear implementation used for both locally sourced clears as well as incoming remote clears.
	 * @param local - Whether the message originated from the local client
	 */
	private clearCore(local: boolean): void {
		this.data.clear();
		this.eventEmitter.emit("clear", local, this.eventEmitter);
	}

	/**
	 * Delete implementation used for both locally sourced deletes as well as incoming remote deletes.
	 * @param key - The key being deleted
	 * @param local - Whether the message originated from the local client
	 * @returns Previous local value of the key if it existed, undefined if it did not exist
	 */
	private deleteCore(key: string, local: boolean): ILocalValue | undefined {
		const previousLocalValue = this.data.get(key);
		const previousValue: unknown = previousLocalValue?.value;
		const successfullyRemoved = this.data.delete(key);
		if (successfullyRemoved) {
			this.eventEmitter.emit(
				"valueChanged",
				{ key, previousValue },
				local,
				this.eventEmitter,
			);
		}
		return previousLocalValue;
	}

	/**
	 * Clear all keys in memory in response to a remote clear, but retain keys we have modified but not yet been ack'd.
	 */
	private clearExceptPendingKeys(): void {
		// Assuming the pendingKeys is small and the map is large
		// we will get the value for the pendingKeys and clear the map
		const temp = new Map<string, ILocalValue>();
		for (const key of this.pendingKeys.keys()) {
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			temp.set(key, this.data.get(key)!);
		}
		this.clearCore(false);
		for (const [key, value] of temp.entries()) {
			this.setCore(key, value, true);
		}
	}

	/**
	 * The remote ISerializableValue we're receiving (either as a result of a load or an incoming set op) will
	 * have the information we need to create a real object, but will not be the real object yet.  For example,
	 * we might know it's a map and the map's ID but not have the actual map or its data yet.  makeLocal's
	 * job is to convert that information into a real object for local usage.
	 * @param key - The key that the caller intends to store the local value into (used for ops later).  But
	 * doesn't actually store the local value into that key.  So better not lie!
	 * @param serializable - The remote information that we can convert into a real object
	 * @returns The local value that was produced
	 */
	private makeLocal(key: string, serializable: ISerializableValue): ILocalValue {
		if (
			serializable.type === ValueType[ValueType.Plain] ||
			serializable.type === ValueType[ValueType.Shared]
		) {
			return this.localValueMaker.fromSerializable(serializable);
		} else {
			throw new Error("Unknown local value type");
		}
	}

	/**
	 * If our local operations that have not yet been ack'd will eventually overwrite an incoming operation, we should
	 * not process the incoming operation.
	 * @param message - Message to process
	 * @param local - Whether the message originated from the local client
	 * @param localOpMetadata - For local client messages, this is the metadata that was submitted with the message.
	 * For messages from a remote client, this will be undefined.
	 * @returns True if the operation should be processed, false otherwise
	 */
	private needProcessKeyOperation(
		message: ISequencedDocumentMessage,
		local: boolean,
		localOpMetadata: MapLocalOpMetadata,
	): boolean {
		const op: IMapKeyOperation = message.contents;
		if (this.pendingClearMessageIds.length > 0) {
			if (local) {
				assert(
					localOpMetadata !== undefined &&
						isMapKeyLocalOpMetadata(localOpMetadata) &&
						localOpMetadata.pendingMessageId < this.pendingClearMessageIds[0],
					0x013 /* "Received out of order op when there is an unackd clear message" */,
				);
			}
			// If we have an unack'd clear, we can ignore all ops.
			return false;
		}

		const pendingKeyMessageId = this.pendingKeys.get(op.key);
		if (pendingKeyMessageId !== undefined) {
			// Found an unack'd op. Clear it from the map if the pendingMessageId in the map matches this message's
			// and don't process the op.
			if (local) {
				assert(
					localOpMetadata !== undefined && isMapKeyLocalOpMetadata(localOpMetadata),
					0x014 /* pendingMessageId is missing from the local client's operation */,
				);
				const pendingMessageIds = this.pendingKeys.get(op.key);
				assert(
					pendingMessageIds !== undefined &&
						pendingMessageIds[0] === localOpMetadata.pendingMessageId,
					0x2fa /* Unexpected pending message received */,
				);
				pendingMessageIds.shift();
				if (pendingMessageIds.length === 0) {
					this.pendingKeys.delete(op.key);
				}
				this.setAttribution(message, op.key);
			}
			return false;
		}

		// If we don't have a NACK op on the key, we need to process the remote ops.
		return !local;
	}

	/**
	 * Get the message handlers for the map.
	 * @returns A map of string op names to IMapMessageHandlers for those ops
	 */
	private getMessageHandlers(): Map<string, IMapMessageHandler> {
		const messageHandlers = new Map<string, IMapMessageHandler>();
		messageHandlers.set("clear", {
			process: (message: ISequencedDocumentMessage, local, localOpMetadata) => {
				if (local) {
					assert(
						isClearLocalOpMetadata(localOpMetadata),
						0x015 /* "pendingMessageId is missing from the local client's clear operation" */,
					);
					const pendingClearMessageId = this.pendingClearMessageIds.shift();
					assert(
						pendingClearMessageId === localOpMetadata.pendingMessageId,
						0x2fb /* pendingMessageId does not match */,
					);
					this.clearAttribution();
					return;
				}
				if (this.pendingKeys.size > 0) {
					this.clearExceptPendingKeys();
					return;
				}
				this.clearAttribution();
				this.clearCore(local);
			},
			submit: (op: IMapClearOperation, localOpMetadata: IMapClearLocalOpMetadata) => {
				assert(
					isClearLocalOpMetadata(localOpMetadata),
					0x2fc /* Invalid localOpMetadata for clear */,
				);
				// We don't reuse the metadata pendingMessageId but send a new one on each submit.
				const pendingClearMessageId = this.pendingClearMessageIds.shift();
				assert(
					pendingClearMessageId === localOpMetadata.pendingMessageId,
					0x2fd /* pendingMessageId does not match */,
				);
				this.submitMapClearMessage(op, localOpMetadata.previousMap);
			},
			applyStashedOp: (op: IMapClearOperation) => {
				const copy = new Map<string, ILocalValue>(this.data);
				this.clearCore(true);
				// We don't reuse the metadata pendingMessageId but send a new one on each submit.
				return createClearLocalOpMetadata(op, this.getMapClearMessageId(), copy);
			},
		});
		messageHandlers.set("delete", {
			process: (message: ISequencedDocumentMessage, local, localOpMetadata) => {
				const op: IMapDeleteOperation = message.contents;
				if (!this.needProcessKeyOperation(message, local, localOpMetadata)) {
					return;
				}
				this.setAttribution(message, op.key);
				this.deleteCore(op.key, local);
			},
			submit: (op: IMapDeleteOperation, localOpMetadata: MapKeyLocalOpMetadata) => {
				this.resubmitMapKeyMessage(op, localOpMetadata);
			},
			applyStashedOp: (op: IMapDeleteOperation) => {
				// We don't reuse the metadata pendingMessageId but send a new one on each submit.
				const previousValue = this.deleteCore(op.key, true);
				return createKeyLocalOpMetadata(op, this.getMapKeyMessageId(op), previousValue);
			},
		});
		messageHandlers.set("set", {
			process: (message: ISequencedDocumentMessage, local, localOpMetadata) => {
				const op: IMapSetOperation = message.contents;
				if (!this.needProcessKeyOperation(message, local, localOpMetadata)) {
					return;
				}

				// needProcessKeyOperation should have returned false if local is true
				this.setAttribution(message, op.key);
				const context = this.makeLocal(op.key, op.value);
				this.setCore(op.key, context, local);
			},
			submit: (op: IMapSetOperation, localOpMetadata: MapKeyLocalOpMetadata) => {
				this.resubmitMapKeyMessage(op, localOpMetadata);
			},
			applyStashedOp: (op: IMapSetOperation) => {
				// We don't reuse the metadata pendingMessageId but send a new one on each submit.
				const context = this.makeLocal(op.key, op.value);
				const previousValue = this.setCore(op.key, context, true);
				return createKeyLocalOpMetadata(op, this.getMapKeyMessageId(op), previousValue);
			},
		});

		return messageHandlers;
	}

	private getMapClearMessageId(): number {
		const pendingMessageId = ++this.pendingMessageId;
		this.pendingClearMessageIds.push(pendingMessageId);
		return pendingMessageId;
	}

	/**
	 * Submit a clear message to remote clients.
	 * @param op - The clear message
	 */
	private submitMapClearMessage(
		op: IMapClearOperation,
		previousMap?: Map<string, ILocalValue>,
	): void {
		const metadata = createClearLocalOpMetadata(op, this.getMapClearMessageId(), previousMap);
		this.submitMessage(op, metadata);
	}

	private getMapKeyMessageId(op: IMapKeyOperation): number {
		const pendingMessageId = ++this.pendingMessageId;
		const pendingMessageIds = this.pendingKeys.get(op.key);
		if (pendingMessageIds !== undefined) {
			pendingMessageIds.push(pendingMessageId);
		} else {
			this.pendingKeys.set(op.key, [pendingMessageId]);
		}
		return pendingMessageId;
	}

	/**
	 * Submit a map key message to remote clients.
	 * @param op - The map key message
	 * @param previousValue - The value of the key before this op
	 */
	private submitMapKeyMessage(op: IMapKeyOperation, previousValue?: ILocalValue): void {
		const localMetadata = createKeyLocalOpMetadata(
			op,
			this.getMapKeyMessageId(op),
			previousValue,
		);
		this.submitMessage(op, localMetadata);
	}

	/**
	 * Submit a map key message to remote clients based on a previous submit.
	 * @param op - The map key message
	 * @param localOpMetadata - Metadata from the previous submit
	 */
	private resubmitMapKeyMessage(op: IMapKeyOperation, localOpMetadata: MapLocalOpMetadata): void {
		assert(
			isMapKeyLocalOpMetadata(localOpMetadata),
			0x2fe /* Invalid localOpMetadata in submit */,
		);

		// clear the old pending message id
		const pendingMessageIds = this.pendingKeys.get(op.key);
		assert(
			pendingMessageIds !== undefined &&
				pendingMessageIds[0] === localOpMetadata.pendingMessageId,
			0x2ff /* Unexpected pending message received */,
		);
		pendingMessageIds.shift();
		if (pendingMessageIds.length === 0) {
			this.pendingKeys.delete(op.key);
		}

		// We don't reuse the metadata pendingMessageId but send a new one on each submit.
		const pendingMessageId = this.getMapKeyMessageId(op);
		const localMetadata =
			localOpMetadata.type === "edit"
				? { type: "edit", pendingMessageId, previousValue: localOpMetadata.previousValue }
				: { type: "add", pendingMessageId };
		this.submitMessage(op, localMetadata);
	}
}
