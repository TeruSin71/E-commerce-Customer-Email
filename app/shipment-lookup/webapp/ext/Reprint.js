// Custom Object Page header action (task 1.16): reprint = fetch the STORED label refs via
// the audited REST route POST /reprint (scope reprint, plant-checked server-side, S2/S3).
// FE V4 contract (SAP docs "Enabling Actions Added Using Extension Points", OData V4):
// the press handler is an application function invoked with (oBindingContext,
// aSelectedContexts) and `this` is NOT the view controller — so no this.getModel here;
// texts come from the app's ResourceBundle directly.
// ponytail: shows a confirmation only — physical BrowserPrint wiring is task 1.15,
// gated on the 0.1 hardware spike.
sap.ui.define(
  ["sap/base/i18n/ResourceBundle", "sap/m/MessageToast", "sap/m/MessageBox"],
  function (ResourceBundle, MessageToast, MessageBox) {
    "use strict";

    var pBundle = ResourceBundle.create({ bundleName: "shipmentlookup.i18n.i18n", async: true });

    // managed-approuter CSRF: GET with x-csrf-token: fetch, echo the token on the POST.
    // Token source = the OData service root: a csrfProtection:true route (xs-app.json) that
    // needs no entity scope — valid for every authenticated role, unlike /dashboard (view)
    // or /reprint (POST-only). Locally (cds watch, no approuter) the header is simply absent.
    function fetchCsrfToken() {
      return fetch("/odata/v4/lookup/", { headers: { "x-csrf-token": "fetch" } })
        .then(function (oRes) {
          return oRes.headers.get("x-csrf-token") || "";
        })
        .catch(function () {
          return "";
        });
    }

    return {
      onReprint: function (oBindingContext) {
        var oShipment = oBindingContext && oBindingContext.getObject ? oBindingContext.getObject() : null;
        pBundle.then(function (oBundle) {
          if (!oShipment || !oShipment.vbeln) {
            MessageToast.show(oBundle.getText("reprintNoContext"));
            return;
          }
          fetchCsrfToken()
            .then(function (sToken) {
              var oHeaders = { "content-type": "application/json" };
              if (sToken) {
                oHeaders["x-csrf-token"] = sToken;
              }
              return fetch("/reprint", {
                method: "POST",
                headers: oHeaders,
                body: JSON.stringify({ vbeln: oShipment.vbeln })
              });
            })
            .then(function (oRes) {
              if (!oRes.ok) {
                throw new Error(String(oRes.status));
              }
              return oRes.json();
            })
            .then(function (aLabels) {
              MessageToast.show(oBundle.getText("reprintReady") + " (" + aLabels.length + ")");
            })
            .catch(function () {
              MessageBox.error(oBundle.getText("reprintFailed"));
            });
        });
      }
    };
  }
);
