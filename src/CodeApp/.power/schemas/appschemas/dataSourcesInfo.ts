/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * This file is auto-generated. Do not modify it manually.
 * Changes to this file may be overwritten.
 */

export const dataSourcesInfo = {
  "businessunits": {
    "tableId": "",
    "version": "",
    "primaryKey": "businessunitid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "jhrb_applydefaults": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Dataverse",
    "apis": {
      "jhrb_ApplyDefaults": {
        "path": "/api/data/v9.2/jhrb_ApplyDefaults",
        "method": "POST",
        "parameters": [
          {
            "name": "Scope",
            "in": "body",
            "required": false,
            "type": "string"
          },
          {
            "name": "UserId",
            "in": "body",
            "required": false,
            "type": "string",
            "format": "guid"
          },
          {
            "name": "Setting",
            "in": "body",
            "required": false,
            "type": "string"
          },
          {
            "name": "DryRun",
            "in": "body",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ApplyMode",
            "in": "body",
            "required": false,
            "type": "string"
          },
          {
            "name": "IgnorePilot",
            "in": "body",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "BatchSize",
            "in": "body",
            "required": false,
            "type": "number"
          },
          {
            "name": "ChunkSeconds",
            "in": "body",
            "required": false,
            "type": "number"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  },
  "jhrb_loadcurrentsettings": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Dataverse",
    "apis": {
      "jhrb_LoadCurrentSettings": {
        "path": "/api/data/v9.2/jhrb_LoadCurrentSettings",
        "method": "POST",
        "parameters": [
          {
            "name": "ProfileId",
            "in": "body",
            "required": false,
            "type": "string",
            "format": "guid"
          },
          {
            "name": "UserId",
            "in": "body",
            "required": false,
            "type": "string",
            "format": "guid"
          },
          {
            "name": "SourceUserId",
            "in": "body",
            "required": false,
            "type": "string",
            "format": "guid"
          },
          {
            "name": "OverwriteManaged",
            "in": "body",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  },
  "jhrb_profilescopes": {
    "tableId": "",
    "version": "",
    "primaryKey": "jhrb_profilescopeid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "jhrb_reconcilesettings": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Dataverse",
    "apis": {
      "jhrb_ReconcileSettings": {
        "path": "/api/data/v9.2/jhrb_ReconcileSettings",
        "method": "POST",
        "parameters": [],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  },
  "jhrb_resolveeffectivesettings": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Dataverse",
    "apis": {
      "jhrb_ResolveEffectiveSettings": {
        "path": "/api/data/v9.2/jhrb_ResolveEffectiveSettings",
        "method": "POST",
        "parameters": [
          {
            "name": "UserId",
            "in": "body",
            "required": false,
            "type": "string",
            "format": "guid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  },
  "jhrb_rolloutjobs": {
    "tableId": "",
    "version": "",
    "primaryKey": "jhrb_rolloutjobid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "jhrb_settingslogs": {
    "tableId": "",
    "version": "",
    "primaryKey": "jhrb_settingslogid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "jhrb_settingsprofiles": {
    "tableId": "",
    "version": "",
    "primaryKey": "jhrb_settingsprofileid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "systemusers": {
    "tableId": "",
    "version": "",
    "primaryKey": "systemuserid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "teams": {
    "tableId": "",
    "version": "",
    "primaryKey": "teamid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "usersettingscollection": {
    "tableId": "",
    "version": "",
    "primaryKey": "systemuserid",
    "dataSourceType": "Dataverse",
    "apis": {}
  }
};
