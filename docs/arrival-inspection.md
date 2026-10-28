# Arrival inspection

The selected-hauler panel offers a direct arrival jump in solo and multiplayer. Interceptors label it as an interception jump. It changes the inspected time without issuing an order or moving the chart camera. The inspector closes as the projected fleet can disappear when its encounter resolves; destination inspection remains a separate action.

The [official Time Machine tutorial](https://vimeo.com/114210812) shows a selected sub's arrival estimate and direct arrival jump at 02:00. That frame was directly inspected and recorded in the [queued-launch reference evidence](queued-launch-editing.md). This implements that UI approach without reproducing its artwork.

The target is the selected visible fleet's exact event time, including preparation, rather than a rounded minute or a relative delay. Bounds come from live time and the available history, not the currently inspected future. A target equal to live time returns to Now. Targets outside the available range are disabled and explained rather than silently clamped. Jumps into history retain the existing historical projection and read-only behavior.

Forecasts still use only current observations. A jump to an unobserved destination cannot reveal its defenders or resolve its combat. Earlier combat, redirection, new orders, and changing contact can alter the trajectory. Arrival inspection does not authorize new fleet visibility or another player's controls. Contact selection clears when the operation or viewer changes.

Validation: 304 tests, TypeScript, web export, and two standalone production-server checks pass. New cases cover exact timestamps, live/history/horizon boundaries, input immutability, resolved observed arrivals, and unresolved hidden destinations. Direct browser acceptance of this new control remains open: both the new and existing Chrome bindings returned `cgWindowNotFound`. Physical-phone and full original-client acceptance remain open in #18.
