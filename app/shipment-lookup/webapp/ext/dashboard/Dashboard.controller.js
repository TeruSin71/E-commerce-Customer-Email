// Dashboard page (task 1.16): counts per (plant, status) from the EXISTING plant-scoped
// REST route GET /dashboard (S3-proven, srv/routes.js). Extends sap.fe.core.PageController —
// the FPM contract for custom pages (routing lifecycle + ExtensionAPI stay wired).
// ponytail: REST + JSONModel, not OData $apply — CAP Node aggregation support unverified;
// switch to $apply groupby on LookupService when it is, and this controller shrinks to zero.
sap.ui.define(["sap/fe/core/PageController", "sap/ui/model/json/JSONModel"], function (PageController, JSONModel) {
  "use strict";
  return PageController.extend("shipmentlookup.ext.dashboard.Dashboard", {
    onInit: function () {
      PageController.prototype.onInit.apply(this);
      var oModel = new JSONModel({ rows: [], busy: true, error: false });
      this.getView().setModel(oModel, "counts");
      fetch("/dashboard")
        .then(function (oRes) {
          if (!oRes.ok) { throw new Error(String(oRes.status)); }
          return oRes.json();
        })
        .then(function (aRows) {
          oModel.setProperty("/rows", aRows);
        })
        .catch(function () {
          oModel.setProperty("/error", true);
        })
        .finally(function () {
          oModel.setProperty("/busy", false);
        });
    }
  });
});
