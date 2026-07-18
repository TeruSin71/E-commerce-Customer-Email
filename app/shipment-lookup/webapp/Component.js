sap.ui.define(
    ["sap/fe/core/AppComponent"],
    function (Component) {
        "use strict";

        return Component.extend("shipmentlookup.Component", {
            metadata: {
                manifest: "json"
            },

            // One app, two launch intents (CourierShipment-lookup / -monitor). FLP always
            // enters the DEFAULT route, so the monitor tile would land on the list. Before
            // routing initializes, append the app-specific route for the dashboard so FE
            // starts directly on DashboardPage. Explicit deep links (hash already has
            // an inner-app route "&/") are left untouched; outside FLP the guard is inert.
            init: function () {
                var sHash = (window.location && window.location.hash) || "";
                if (sHash.indexOf("CourierShipment-monitor") > -1 && sHash.indexOf("&/") === -1) {
                    // eslint-disable-next-line @sap-ux/fiori-tools/sap-no-location-usage -- appending the
                    // app-specific route BEFORE routing init is the point; URLHelper has no equivalent
                    window.location.hash = sHash + "&/dashboard";
                }
                Component.prototype.init.apply(this, arguments);
            }
        });
    }
);
