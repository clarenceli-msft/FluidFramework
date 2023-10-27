/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "assert";
import {
	MockContainerRuntimeFactory,
	MockContainerRuntimeFactoryForReconnection,
	MockContainerRuntimeForReconnection,
	MockFluidDataStoreRuntime,
	MockSharedObjectServices,
	MockStorage,
} from "@fluidframework/test-runtime-utils";
import {
	DirectoryFactory,
	DirectoryLocalOpMetadata,
	IDirectoryOperation,
	SharedDirectory,
} from "../../directory";
import { ISharedDirectory } from "../../interfaces";

function createConnectedDirectory(
	id: string,
	runtimeFactory: MockContainerRuntimeFactory,
): SharedDirectory {
	const dataStoreRuntime = new MockFluidDataStoreRuntime();
	const containerRuntime = runtimeFactory.createContainerRuntime(dataStoreRuntime);
	const services = {
		deltaConnection: dataStoreRuntime.createDeltaConnection(),
		objectStorage: new MockStorage(),
	};
	const directory = new SharedDirectory(id, dataStoreRuntime, DirectoryFactory.Attributes);
	directory.connect(services);
	return directory;
}

class TestSharedDirectory extends SharedDirectory {
	public testApplyStashedOp(content: IDirectoryOperation): DirectoryLocalOpMetadata {
		return this.applyStashedOp(content) as DirectoryLocalOpMetadata;
	}
}

async function populate(directory: SharedDirectory, content: unknown): Promise<void> {
	const storage = new MockSharedObjectServices({
		header: JSON.stringify(content),
	});
	return directory.load(storage);
}

function assertDirectoryIterationOrder(directory: ISharedDirectory, expectedDirNames: string[]) {
	const actualDirNames: string[] = [];
	for (const [subdirName, subdirObject] of directory.subdirectories()) {
		actualDirNames.push(subdirName);
	}
	assert.deepEqual(actualDirNames, expectedDirNames);
}

describe("Directory Iteration Order", () => {
	describe("Local state", () => {
		let directory: SharedDirectory;
		let dataStoreRuntime: MockFluidDataStoreRuntime;

		beforeEach(async () => {
			dataStoreRuntime = new MockFluidDataStoreRuntime();
			dataStoreRuntime.local = true;
			directory = new SharedDirectory(
				"directory",
				dataStoreRuntime,
				DirectoryFactory.Attributes,
			);
		});

		it("create subdirectories", () => {
			directory.createSubDirectory("b");
			directory.createSubDirectory("a");
			directory.createSubDirectory("c");

			assertDirectoryIterationOrder(directory, ["b", "a", "c"]);
		});

		it("create nested subdirectories", () => {
			directory.createSubDirectory("c").createSubDirectory("c-a");
			directory.createSubDirectory("a").createSubDirectory("a-b");
			directory.createSubDirectory("a").createSubDirectory("a-a");
			directory.createSubDirectory("b");
			directory.createSubDirectory("c").createSubDirectory("c-c");
			directory.createSubDirectory("a").createSubDirectory("a-c");
			directory.createSubDirectory("c").createSubDirectory("c-b");

			assertDirectoryIterationOrder(directory, ["c", "a", "b"]);
			assert.notEqual(directory.getWorkingDirectory("/a"), undefined);
			assertDirectoryIterationOrder(directory.getWorkingDirectory("/a") as ISharedDirectory, [
				"a-b",
				"a-a",
				"a-c",
			]);
			assert.notEqual(directory.getWorkingDirectory("/b"), undefined);
			assertDirectoryIterationOrder(
				directory.getWorkingDirectory("/b") as ISharedDirectory,
				[],
			);
			assert.notEqual(directory.getWorkingDirectory("/c"), undefined);
			assertDirectoryIterationOrder(directory.getWorkingDirectory("/c") as ISharedDirectory, [
				"c-a",
				"c-c",
				"c-b",
			]);
		});

		it("delete subdirectories", () => {
			directory.createSubDirectory("c").createSubDirectory("c-a");
			directory.createSubDirectory("a").createSubDirectory("a-b");
			directory.createSubDirectory("a").createSubDirectory("a-a");
			directory.createSubDirectory("b");
			directory.createSubDirectory("c").createSubDirectory("c-c");
			directory.createSubDirectory("a").createSubDirectory("a-c");
			directory.createSubDirectory("c").createSubDirectory("c-b");

			directory.deleteSubDirectory("a");
			assertDirectoryIterationOrder(directory, ["c", "b"]);

			directory.createSubDirectory("a");
			assertDirectoryIterationOrder(directory, ["c", "b", "a"]);

			directory.getWorkingDirectory("/c")?.createSubDirectory("c-d");
			directory.getWorkingDirectory("/c")?.deleteSubDirectory("c-c");

			assertDirectoryIterationOrder(directory.getWorkingDirectory("/c") as ISharedDirectory, [
				"c-a",
				"c-b",
				"c-d",
			]);
		});
	});

	describe("Connected state", () => {
		let containerRuntimeFactory: MockContainerRuntimeFactory;
		let directory1: SharedDirectory;
		let directory2: SharedDirectory;

		beforeEach(async () => {
			containerRuntimeFactory = new MockContainerRuntimeFactory();
			// Create the first directory.
			directory1 = createConnectedDirectory("directory1", containerRuntimeFactory);
			// Create the second directory.
			directory2 = createConnectedDirectory("directory2", containerRuntimeFactory);
		});

		it("Remote messages have no conflict with the local pending ops", () => {
			directory1.createSubDirectory("a");
			directory1.createSubDirectory("b").createSubDirectory("b-a");
			directory2.createSubDirectory("c").createSubDirectory("c-b");
			directory2.createSubDirectory("d");
			directory1.deleteSubDirectory("a");

			containerRuntimeFactory.processSomeMessages(3);
			assertDirectoryIterationOrder(directory1, ["b"]);
			assertDirectoryIterationOrder(directory2, ["a", "b", "c", "d"]);

			containerRuntimeFactory.processSomeMessages(3);
			assertDirectoryIterationOrder(directory1, ["b", "c", "d"]);
			assertDirectoryIterationOrder(directory2, ["a", "b", "c", "d"]);

			containerRuntimeFactory.processAllMessages();
			assertDirectoryIterationOrder(directory1, ["b", "c", "d"]);
			assertDirectoryIterationOrder(directory2, ["b", "c", "d"]);
		});

		it("Remote messages have conflicts with the local pending ops", () => {
			directory1.createSubDirectory("b");
			directory2.createSubDirectory("a");
			directory2.createSubDirectory("b");

			containerRuntimeFactory.processSomeMessages(3);
			assertDirectoryIterationOrder(directory1, ["b", "a"]);
			assertDirectoryIterationOrder(directory2, ["b", "a"]);

			directory1.createSubDirectory("d").createSubDirectory("d-b");
			directory2.createSubDirectory("d").createSubDirectory("d-a");

			containerRuntimeFactory.processSomeMessages(4);
			assertDirectoryIterationOrder(directory1, ["b", "a", "d"]);
			assertDirectoryIterationOrder(directory2, ["b", "a", "d"]);

			assert.notEqual(directory1.getWorkingDirectory("/d"), undefined);
			assertDirectoryIterationOrder(
				directory1.getWorkingDirectory("/d") as ISharedDirectory,
				["d-b", "d-a"],
			);

			assert.notEqual(directory2.getWorkingDirectory("/d"), undefined);
			assertDirectoryIterationOrder(
				directory2.getWorkingDirectory("/d") as ISharedDirectory,
				["d-b", "d-a"],
			);

			directory1.deleteSubDirectory("d");
			directory2.getWorkingDirectory("/d")?.createSubDirectory("d-c");

			assertDirectoryIterationOrder(directory1, ["b", "a"]);
			assertDirectoryIterationOrder(directory2, ["b", "a", "d"]);
			assertDirectoryIterationOrder(
				directory2.getWorkingDirectory("/d") as ISharedDirectory,
				["d-b", "d-a", "d-c"],
			);

			containerRuntimeFactory.processAllMessages();
			assertDirectoryIterationOrder(directory1, ["b", "a"]);
			assertDirectoryIterationOrder(directory2, ["b", "a"]);
		});
	});

	describe("Serialization/Load", () => {
		let directory1: SharedDirectory;

		it("can be compatible with the old format summary", async () => {
			const dataStoreRuntime = new MockFluidDataStoreRuntime();
			dataStoreRuntime.local = true;
			directory1 = new SharedDirectory(
				"directory",
				dataStoreRuntime,
				DirectoryFactory.Attributes,
			);

			await populate(directory1, {
				storage: {
					key1: {
						type: "Plain",
						value: "val1",
					},
					key2: {
						type: "Plain",
						value: "val2",
					},
				},
				subdirectories: {
					b: {
						storage: {
							testKey: {
								type: "Plain",
								value: "testValue",
							},
							testKey2: {
								type: "Plain",
								value: "testValue2",
							},
						},
					},
					c: {
						storage: {
							testKey3: {
								type: "Plain",
								value: "testValue3",
							},
						},
					},
					a: {
						storage: {},
					},
				},
			});

			assertDirectoryIterationOrder(directory1, ["b", "c", "a"]);
		});

		it("can be compatible with the new format summary", async () => {
			const dataStoreRuntime = new MockFluidDataStoreRuntime();
			dataStoreRuntime.local = true;
			directory1 = new SharedDirectory(
				"directory",
				dataStoreRuntime,
				DirectoryFactory.Attributes,
			);

			await populate(directory1, {
				storage: {
					key1: {
						type: "Plain",
						value: "val1",
					},
					key2: {
						type: "Plain",
						value: "val2",
					},
				},
				subdirectories: {
					b: {
						storage: {
							testKey: {
								type: "Plain",
								value: "testValue",
							},
							testKey2: {
								type: "Plain",
								value: "testValue2",
							},
						},
						ci: {
							csn: 4,
							ccIds: ["client1"],
							ccsn: 1,
						},
					},
					c: {
						storage: {
							testKey3: {
								type: "Plain",
								value: "testValue3",
							},
						},
						subdirectories: {
							c_b: {
								storage: {},
								ci: {
									csn: 5,
									ccIds: ["client1"],
									ccsn: 1,
								},
							},
							c_a: {
								storage: {},
								ci: {
									csn: 6,
									ccIds: ["client1"],
									ccsn: 1,
								},
							},
						},
						ci: {
							csn: 2,
							ccIds: ["client2"],
							ccsn: 1,
						},
					},
					a: {
						storage: {},
						ci: {
							csn: 4,
							ccIds: ["client2"],
							ccsn: 2,
						},
					},
				},
				ci: {
					csn: 1,
					ccIds: ["client1", "client2"],
				},
			});

			assertDirectoryIterationOrder(directory1, ["c", "b", "a"]);
			assert(directory1.getWorkingDirectory("/c"));
			assertDirectoryIterationOrder(
				directory1.getWorkingDirectory("/c") as ISharedDirectory,
				["c_b", "c_a"],
			);
		});

		it("serialize the contents, load it into another directory and maintain the order", async () => {
			directory1 = new SharedDirectory(
				"dir1",
				new MockFluidDataStoreRuntime(),
				DirectoryFactory.Attributes,
			);
			directory1.createSubDirectory("c");
			directory1.createSubDirectory("b");
			directory1.createSubDirectory("a");

			const containerRuntimeFactory = new MockContainerRuntimeFactory();
			const dataStoreRuntime = new MockFluidDataStoreRuntime();
			const containerRuntime =
				containerRuntimeFactory.createContainerRuntime(dataStoreRuntime);
			const services = MockSharedObjectServices.createFromSummary(
				directory1.getAttachSummary().summary,
			);
			services.deltaConnection = dataStoreRuntime.createDeltaConnection();

			const directory2 = new SharedDirectory(
				"map2",
				dataStoreRuntime,
				DirectoryFactory.Attributes,
			);
			await directory2.load(services);

			assertDirectoryIterationOrder(directory2, ["c", "b", "a"]);
		});
	});

	describe("Reconnection", () => {
		let containerRuntimeFactory: MockContainerRuntimeFactoryForReconnection;
		let containerRuntime1: MockContainerRuntimeForReconnection;
		let containerRuntime2: MockContainerRuntimeForReconnection;
		let directory1: SharedDirectory;
		let directory2: SharedDirectory;

		beforeEach(async () => {
			containerRuntimeFactory = new MockContainerRuntimeFactoryForReconnection();

			// Create the first SharedDirectory
			const dataStoreRuntime1 = new MockFluidDataStoreRuntime();
			containerRuntime1 = containerRuntimeFactory.createContainerRuntime(dataStoreRuntime1);
			const services1 = {
				deltaConnection: dataStoreRuntime1.createDeltaConnection(),
				objectStorage: new MockStorage(),
			};
			directory1 = new SharedDirectory(
				"dir1",
				dataStoreRuntime1,
				DirectoryFactory.Attributes,
			);
			directory1.connect(services1);

			// Create the second SharedDirectory
			const dataStoreRuntime2 = new MockFluidDataStoreRuntime();
			containerRuntime2 = containerRuntimeFactory.createContainerRuntime(dataStoreRuntime2);
			const services2 = {
				deltaConnection: dataStoreRuntime2.createDeltaConnection(),
				objectStorage: new MockStorage(),
			};
			directory2 = new SharedDirectory(
				"dir1",
				dataStoreRuntime2,
				DirectoryFactory.Attributes,
			);
			directory2.connect(services2);
		});

		it("Can resend unacked ops on reconnection and impact the order", async () => {
			directory1.createSubDirectory("a");
			directory1.createSubDirectory("b");
			directory2.createSubDirectory("c");
			directory2.createSubDirectory("b");

			// Disconnect and reconnect the first client
			containerRuntime1.connected = false;
			containerRuntime1.connected = true;

			containerRuntimeFactory.processAllMessages();

			assertDirectoryIterationOrder(directory1, ["c", "b", "a"]);
			assertDirectoryIterationOrder(directory2, ["c", "b", "a"]);
		});

		it("can maintain order when a client disconnects in the meanwhile", async () => {
			directory1.createSubDirectory("c");
			containerRuntimeFactory.processAllMessages();

			// Disconnect the first client
			containerRuntime1.connected = false;

			directory1.createSubDirectory("a");
			directory2.createSubDirectory("d");
			directory2.createSubDirectory("b");

			// Reconnect the first client.
			containerRuntime1.connected = true;

			assertDirectoryIterationOrder(directory1, ["c", "a"]);
			assertDirectoryIterationOrder(directory2, ["c", "d", "b"]);

			containerRuntimeFactory.processAllMessages();

			assertDirectoryIterationOrder(directory1, ["c", "d", "b", "a"]);
			assertDirectoryIterationOrder(directory2, ["c", "d", "b", "a"]);
		});
	});

	describe("Op Processing", () => {
		let directory: TestSharedDirectory;

		beforeEach(async () => {
			const dataStoreRuntime = new MockFluidDataStoreRuntime();
			directory = new TestSharedDirectory(
				"dir1",
				dataStoreRuntime,
				DirectoryFactory.Attributes,
			);
		});

		it("applyStashedOp", async () => {
			const op1: IDirectoryOperation = {
				type: "createSubDirectory",
				path: "./",
				subdirName: "c",
			};
			const op2: IDirectoryOperation = {
				type: "createSubDirectory",
				path: "./",
				subdirName: "b",
			};
			const op3: IDirectoryOperation = {
				type: "createSubDirectory",
				path: "./",
				subdirName: "a",
			};
			const op4: IDirectoryOperation = {
				type: "deleteSubDirectory",
				path: "./",
				subdirName: "b",
			};

			directory.testApplyStashedOp(op1);
			directory.testApplyStashedOp(op2);
			directory.testApplyStashedOp(op3);

			assertDirectoryIterationOrder(directory, ["c", "b", "a"]);

			directory.testApplyStashedOp(op4);

			assertDirectoryIterationOrder(directory, ["c", "a"]);
		});
	});
});