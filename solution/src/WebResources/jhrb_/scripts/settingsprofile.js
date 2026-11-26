// Web resource jhrb_/scripts/settingsprofile.js: commands on the Settings Profile form.
// "Load current values" calls the jhrb_LoadCurrentSettings Custom API, which copies a user's current personal
// settings into this profile's value columns. Modes are not changed, so nothing is rolled out until the admin
// sets a setting to Default or Locked and saves.
var jhrb = window.jhrb || {};
jhrb.SettingsProfile = (function () {
  var USER = 632490002;
  var NOTE = "jhrb_loadcurrent";

  function alertDialog(text) {
    return Xrm.Navigation.openAlertDialog({ title: "Load current values", text: text });
  }

  function loadCurrentSettings(profileId) {
    var request = {
      ProfileId: { guid: profileId }, // Xrm.WebApi serializes Edm.Guid parameters from { guid }
      getMetadata: function () {
        return {
          boundParameter: null,
          parameterTypes: { ProfileId: { typeName: "Edm.Guid", structuralProperty: 1 } },
          operationType: 0,
          operationName: "jhrb_LoadCurrentSettings"
        };
      }
    };
    return Xrm.WebApi.online.execute(request).then(function (r) { return r.json(); });
  }

  async function loadCurrentValues(primaryControl) {
    var form = primaryControl;
    var id = (form.data.entity.getId() || "").replace(/[{}]/g, "");
    if (!id) { await alertDialog("Save the profile first."); return; }

    var type = form.getAttribute("jhrb_type").getValue();
    var user = form.getAttribute("jhrb_user") && form.getAttribute("jhrb_user").getValue();
    var source = type === USER && user ? user[0].name + "'s" : "your own";
    var confirmed = await Xrm.Navigation.openConfirmDialog({
      title: "Load current values",
      text: "Copy " + source + " current personal settings into this profile? Only settings on Inherit are filled. " +
        "Settings on Default or Locked keep their values, and no mode is changed."
    });
    if (!confirmed.confirmed) return;

    try {
      if (form.data.entity.getIsDirty()) await form.data.save();
      Xrm.Utility.showProgressIndicator("Loading current values...");
      var result = await loadCurrentSettings(id);
      await form.data.refresh(false);
      form.ui.setFormNotification(
        "Loaded " + result.Loaded + " value(s)" + (result.KeptManaged ? "; kept " + result.KeptManaged + " managed setting(s)" : "") +
        ". Set a mode to Default or Locked to apply a value.", "INFO", NOTE);
    } catch (e) {
      await alertDialog(e && e.message ? e.message : String(e));
    } finally {
      Xrm.Utility.closeProgressIndicator();
    }
  }

  return { loadCurrentValues: loadCurrentValues };
})();
window.jhrb = jhrb;
