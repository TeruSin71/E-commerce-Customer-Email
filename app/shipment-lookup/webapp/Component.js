sap.ui.define(
    ["sap/fe/core/AppComponent", "sap/ui/core/routing/HashChanger"],
    function (Component, HashChanger) {
        "use strict";

        return Component.extend("shipmentlookup.Component", {
            metadata: {
                manifest: "json"
            },

            // One app, two launch intents (CourierShipment-lookup / -monitor). FLP always
            // enters the DEFAULT route, so the monitor tile would land on the list. Seed the
            // app-specific route BEFORE routing initializes so FE starts on DashboardPage.
            // HashChanger is the shell-integrated API — in Work Zone it owns the app part of
            // the hash, so (unlike a raw window.location write) the shell can't revert it.
            // Explicit deep links (inner-app route already present) are left untouched;
            // outside FLP the guard is inert.
            init: function () {
                var sHash = (window.location && window.location.hash) || "";
                if (sHash.indexOf("CourierShipment-monitor") > -1 && sHash.indexOf("&/") === -1) {
                    HashChanger.getInstance().replaceHash("dashboard");
                }
                Component.prototype.init.apply(this, arguments);
            }
        });
    }
);
