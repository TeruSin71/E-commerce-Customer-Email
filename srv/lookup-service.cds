// Read-only OData projection for the Fiori Shipment Lookup + Dashboard (task 1.16).
// Serves the UI-read surface ONLY — the money path (/book, /void, ...) stays on the
// audited express routes (srv/routes.js). Doc 08 §3 records this OData addition.
// PII discipline: label_bytes / ship_to_email / rate columns are NEVER projected (S2/H2).
// Plant + scope enforcement for this path lives in srv/lookup-service.js (S3/H3).
using courier from '../db/schema';

service LookupService {

  @readonly
  entity Shipments as projection on courier.Shipments {
    ID,
    vbeln,
    exidv,
    so_number,
    werks,
    carrier_id,
    tracking_number,
    status,
    is_primary,
    ship_to_name,
    ship_to_country,
    // lifecycle timestamps = the support "events" view (doc 08 §10 monitoring fields)
    // ponytail: raw ShipmentEvents scan history not exposed — it has no werks column, so
    // plant-scoping needs a join; add a join-scoped projection when support asks for it.
    packed_at,
    booked_at,
    printed_at,
    pgi_at,
    first_scan_at
  };
}

// ── UI annotations (Fiori Elements List Report + Object Page, task 1.16) ──
annotate LookupService.Shipments with @(
  UI: {
    HeaderInfo: {
      TypeName: 'Shipment',
      TypeNamePlural: 'Shipments',
      Title: { $Type: 'UI.DataField', Value: vbeln },
      Description: { $Type: 'UI.DataField', Value: tracking_number }
    },
    SelectionFields: [ vbeln, tracking_number, so_number, status, werks ],
    LineItem: [
      { Value: vbeln },
      { Value: exidv },
      { Value: so_number },
      { Value: tracking_number },
      { Value: status },
      { Value: werks },
      { Value: booked_at },
      { Value: first_scan_at }
    ],
    Facets: [
      { $Type: 'UI.ReferenceFacet', ID: 'Ship', Label: 'Shipment', Target: '@UI.FieldGroup#Ship' },
      { $Type: 'UI.ReferenceFacet', ID: 'Lifecycle', Label: 'Lifecycle', Target: '@UI.FieldGroup#Lifecycle' }
    ],
    FieldGroup #Ship: { Data: [
      { Value: vbeln },
      { Value: exidv },
      { Value: so_number },
      { Value: werks },
      { Value: carrier_id },
      { Value: tracking_number },
      { Value: status },
      { Value: is_primary },
      { Value: ship_to_name },
      { Value: ship_to_country }
    ]},
    // lifecycle timestamps = the support "events" view (doc 08 §10)
    FieldGroup #Lifecycle: { Data: [
      { Value: packed_at },
      { Value: booked_at },
      { Value: printed_at },
      { Value: pgi_at },
      { Value: first_scan_at }
    ]}
  }
);

annotate LookupService.Shipments with {
  vbeln           @title: 'Delivery';
  exidv           @title: 'Handling Unit';
  so_number       @title: 'Sales Order';
  werks           @title: 'Plant';
  carrier_id      @title: 'Carrier';
  tracking_number @title: 'Tracking No.';
  status          @title: 'Status';
  is_primary      @title: 'Primary HU';
  ship_to_name    @title: 'Ship-to Name';
  ship_to_country @title: 'Ship-to Country';
  packed_at       @title: 'Packed';
  booked_at       @title: 'Booked';
  printed_at      @title: 'Printed';
  pgi_at          @title: 'Goods Issued';
  first_scan_at   @title: 'First Carrier Scan';
}
