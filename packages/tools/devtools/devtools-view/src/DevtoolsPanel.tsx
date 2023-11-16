/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
import React from "react";

import { type IMessageRelay } from "@fluid-experimental/devtools-core";
import { type ITelemetryBaseLogger } from "@fluidframework/core-interfaces";
import { DevtoolsView } from "./DevtoolsView";
import { MessageRelayContext } from "./MessageRelayContext";

/**
 * {@link DevtoolsPanel} input props.
 *
 * @public
 */
export interface DevtoolsPanelProps {
	/**
	 * An instance of {@link @fluid-experimental/devtools-core#IMessageRelay} that can handle message passing between the
	 * devtools's "brain" and its UI, in whatever context the latter is being rendered (e.g. in the same page as the
	 * application, or in the browser's Devtools panel).
	 */
	messageRelay: IMessageRelay;

	/**
	 * An optional {@link @fluidframework/core-interfaces#ITelemetryBaseLogger} instance that will be passed any usage
	 * telemetry generated by Devtools.
	 *
	 * @remarks
	 * We're only interested in usage telemetry when Devtools runs as a browser extension.
	 * While technically this logger can also be provided in our example applications where we render the Devtools panel
	 * inline with the app, it should *not* be used in those cases.
	 */
	usageTelemetryLogger?: ITelemetryBaseLogger;

	/**
	 * Optional function that will be invoked when the React component for the Devtools panel is unloaded.
	 */
	unloadCallback?: () => void;
}

/**
 * Top-level view for the Fluid Devtools.
 *
 * @remarks Initializes the message relay context required by internal components.
 *
 * @public
 */
export function DevtoolsPanel(props: DevtoolsPanelProps): React.ReactElement {
	const { usageTelemetryLogger, messageRelay, unloadCallback } = props;

	React.useEffect(() => {
		// Called when the React component for the Devtools panel is unloaded.
		return (): void => {
			unloadCallback?.();
		};
	}, [unloadCallback]);

	return (
		<MessageRelayContext.Provider value={messageRelay}>
			<DevtoolsView usageTelemetryLogger={usageTelemetryLogger} />
		</MessageRelayContext.Provider>
	);
}
