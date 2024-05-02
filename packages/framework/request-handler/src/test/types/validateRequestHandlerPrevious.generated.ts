/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/*
 * THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
 * Generated by fluid-type-test-generator in @fluidframework/build-tools.
 */

import type * as old from "@fluidframework/request-handler-previous/internal";
import type * as current from "../../index.js";

// See 'build-tools/src/type-test-generator/compatibility.ts' for more information.
type TypeOnly<T> = T extends number
	? number
	: T extends string
	? string
	: T extends boolean | bigint | symbol
	? T
	: {
			[P in keyof T]: TypeOnly<T[P]>;
	  };

/*
 * Validate forward compatibility by using the old type in place of the current type.
 * If this test starts failing, it indicates a change that is not forward compatible.
 * To acknowledge the breaking change, add the following to package.json under
 * typeValidation.broken:
 * "TypeAliasDeclaration_RuntimeRequestHandler": {"forwardCompat": false}
 */
declare function get_old_TypeAliasDeclaration_RuntimeRequestHandler():
    TypeOnly<old.RuntimeRequestHandler>;
declare function use_current_TypeAliasDeclaration_RuntimeRequestHandler(
    use: TypeOnly<current.RuntimeRequestHandler>): void;
use_current_TypeAliasDeclaration_RuntimeRequestHandler(
    get_old_TypeAliasDeclaration_RuntimeRequestHandler());

/*
 * Validate backward compatibility by using the current type in place of the old type.
 * If this test starts failing, it indicates a change that is not backward compatible.
 * To acknowledge the breaking change, add the following to package.json under
 * typeValidation.broken:
 * "TypeAliasDeclaration_RuntimeRequestHandler": {"backCompat": false}
 */
declare function get_current_TypeAliasDeclaration_RuntimeRequestHandler():
    TypeOnly<current.RuntimeRequestHandler>;
declare function use_old_TypeAliasDeclaration_RuntimeRequestHandler(
    use: TypeOnly<old.RuntimeRequestHandler>): void;
use_old_TypeAliasDeclaration_RuntimeRequestHandler(
    get_current_TypeAliasDeclaration_RuntimeRequestHandler());

/*
 * Validate forward compatibility by using the old type in place of the current type.
 * If this test starts failing, it indicates a change that is not forward compatible.
 * To acknowledge the breaking change, add the following to package.json under
 * typeValidation.broken:
 * "FunctionDeclaration_buildRuntimeRequestHandler": {"forwardCompat": false}
 */
declare function get_old_FunctionDeclaration_buildRuntimeRequestHandler():
    TypeOnly<typeof old.buildRuntimeRequestHandler>;
declare function use_current_FunctionDeclaration_buildRuntimeRequestHandler(
    use: TypeOnly<typeof current.buildRuntimeRequestHandler>): void;
use_current_FunctionDeclaration_buildRuntimeRequestHandler(
    get_old_FunctionDeclaration_buildRuntimeRequestHandler());

/*
 * Validate backward compatibility by using the current type in place of the old type.
 * If this test starts failing, it indicates a change that is not backward compatible.
 * To acknowledge the breaking change, add the following to package.json under
 * typeValidation.broken:
 * "FunctionDeclaration_buildRuntimeRequestHandler": {"backCompat": false}
 */
declare function get_current_FunctionDeclaration_buildRuntimeRequestHandler():
    TypeOnly<typeof current.buildRuntimeRequestHandler>;
declare function use_old_FunctionDeclaration_buildRuntimeRequestHandler(
    use: TypeOnly<typeof old.buildRuntimeRequestHandler>): void;
use_old_FunctionDeclaration_buildRuntimeRequestHandler(
    get_current_FunctionDeclaration_buildRuntimeRequestHandler());
