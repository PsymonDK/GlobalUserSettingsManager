using System;
using DefaultUserSettings.Plugins.Values;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.Xrm.Sdk;
using static DefaultUserSettings.Plugins.Tests.Build;

namespace DefaultUserSettings.Plugins.Tests
{
    [TestClass]
    public class CurrentValueLoaderTests
    {
        private static Entity Current(params (string attr, object value)[] values)
        {
            var e = new Entity("usersettings", UserId);
            foreach (var (attr, value) in values) e[attr] = value;
            return e;
        }

        [TestMethod]
        public void NewProfile_LoadsAllNonNullValues_ConvertedToProfileTypes()
        {
            var dash = Guid.NewGuid();
            var cur = Guid.NewGuid();
            var r = CurrentValueLoader.Build(null, Current(
                ("paginglimit", 75), ("displaydensity", new OptionSetValue(1)), ("issendasallowed", true),
                ("defaultdashboardid", dash), ("transactioncurrencyid", new EntityReference("transactioncurrency", cur)),
                ("timezonecode", null)), overwriteManaged: false);

            Assert.AreEqual(5, r.Loaded.Count);
            Assert.AreEqual(75, r.Update["jhrb_paginglimit"]);
            Assert.AreEqual(1, ((OptionSetValue)r.Update["jhrb_displaydensity"]).Value);
            Assert.AreEqual(dash.ToString(), r.Update["jhrb_defaultdashboardid"]);
            Assert.AreEqual(cur, ((EntityReference)r.Update["jhrb_transactioncurrencyid"]).Id);
            Assert.IsFalse(r.Update.Contains("jhrb_timezonecode"));
        }

        [TestMethod]
        public void ModesAreNeverWritten()
        {
            var r = CurrentValueLoader.Build(null, Current(("paginglimit", 75)), overwriteManaged: true);
            Assert.IsFalse(r.Update.Contains("jhrb_paginglimit_mode"));
        }

        [TestMethod]
        public void ManagedSettings_KeptUnlessOverwrite()
        {
            var u = User(UserId).With("paginglimit", SettingMode.Locked, 50).With("timezonecode", SettingMode.Inherit, 4);
            var us = Current(("paginglimit", 75), ("timezonecode", 105));

            var keep = CurrentValueLoader.Build(u, us, overwriteManaged: false);
            CollectionAssert.AreEqual(new[] { "timezonecode" }, keep.Loaded);
            CollectionAssert.AreEqual(new[] { "paginglimit" }, keep.KeptManaged);
            Assert.AreEqual(105, keep.Update["jhrb_timezonecode"]);

            var overwrite = CurrentValueLoader.Build(u, us, overwriteManaged: true);
            Assert.AreEqual(2, overwrite.Loaded.Count);
            Assert.AreEqual(75, overwrite.Update["jhrb_paginglimit"]);
        }

        [TestMethod]
        public void UnchangedValues_AreNotWritten()
        {
            var u = User(UserId).With("paginglimit", SettingMode.Inherit, 75);
            var r = CurrentValueLoader.Build(u, Current(("paginglimit", 75)), overwriteManaged: false);
            Assert.AreEqual(0, r.Loaded.Count);
            Assert.AreEqual(0, r.Update.Attributes.Count);
        }
    }
}
