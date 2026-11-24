using System;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using DefaultUserSettings.Plugins.Resolution;
using DefaultUserSettings.Plugins.Rollout;
using DefaultUserSettings.Plugins.Values;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.Xrm.Sdk;
using static DefaultUserSettings.Plugins.Tests.Build;

namespace DefaultUserSettings.Plugins.Tests
{
    [TestClass]
    public class PlannerTests
    {
        private static Entity Current(params (string, object)[] values)
        {
            var e = new Entity("usersettings", UserId);
            foreach (var (k, v) in values) e[k] = v;
            return e;
        }

        private static SettingsProfile G() =>
            Global().With("paginglimit", SettingMode.Default, 50).With("timezonecode", SettingMode.Locked, 105).With("showweeknumber", SettingMode.Default, true);

        [TestMethod]
        public void Full_writes_only_differing_default_and_locked_values()
        {
            var plan = RolloutPlanner.Plan(UserId, new[] { G() }, Member(), Current(("paginglimit", 75), ("timezonecode", 105), ("showweeknumber", false)), ApplyMode.Full, null, null);
            CollectionAssert.AreEquivalent(new[] { "paginglimit", "showweeknumber" }, plan.Changes.Select(c => c.Effective.Definition.Attribute).ToArray());
            Assert.AreEqual(75, plan.Changes.Single(c => c.Effective.Definition.Attribute == "paginglimit").OldValue);
            Assert.AreEqual(50, plan.ToUpdate()["paginglimit"]);
            Assert.IsTrue(plan.WriteState);
        }

        [TestMethod]
        public void LockedOnly_ignores_defaults()
        {
            var plan = RolloutPlanner.Plan(UserId, new[] { G() }, Member(), Current(("paginglimit", 75), ("timezonecode", 110)), ApplyMode.LockedOnly, null, null);
            Assert.AreEqual("timezonecode", plan.Changes.Single().Effective.Definition.Attribute);
            Assert.IsFalse(plan.WriteState);
        }

        [TestMethod]
        public void Auto_is_full_for_new_or_changed_layers_and_locked_only_otherwise()
        {
            var profiles = new[] { G() };
            var current = Current(("paginglimit", 75), ("timezonecode", 110));
            var fp = RolloutPlanner.Fingerprint(ProfileResolver.Layers(profiles, Member()));

            Assert.AreEqual(ApplyMode.Full, RolloutPlanner.Plan(UserId, profiles, Member(), current, ApplyMode.Auto, null, null).EffectiveMode, "never initialized");
            Assert.AreEqual(ApplyMode.Full, RolloutPlanner.Plan(UserId, profiles, Member(), current, ApplyMode.Auto, null, "other").EffectiveMode, "layers changed");
            var same = RolloutPlanner.Plan(UserId, profiles, Member(), current, ApplyMode.Auto, null, fp);
            Assert.AreEqual(ApplyMode.LockedOnly, same.EffectiveMode, "unchanged layers");
            Assert.AreEqual(1, same.Changes.Count, "user's own Default change (paginglimit 75) is kept");
        }

        [TestMethod]
        public void Fingerprint_changes_with_membership_and_priority_order()
        {
            var g = G();
            var a = Group("A", 10, TeamScope(TeamA));
            var b = Group("B", 20, TeamScope(TeamB));
            var both = RolloutPlanner.Fingerprint(ProfileResolver.Layers(new[] { g, a, b }, Member(TeamA, TeamB)));
            var onlyA = RolloutPlanner.Fingerprint(ProfileResolver.Layers(new[] { g, a, b }, Member(TeamA)));
            Assert.AreNotEqual(both, onlyA);
            a.Priority = 30;
            Assert.AreNotEqual(both, RolloutPlanner.Fingerprint(ProfileResolver.Layers(new[] { g, a, b }, Member(TeamA, TeamB))), "priority swap reorders layers");
        }

        [TestMethod]
        public void Setting_filter_limits_writes()
        {
            var plan = RolloutPlanner.Plan(UserId, new[] { G() }, Member(), Current(("paginglimit", 75), ("timezonecode", 110)), ApplyMode.Full,
                RolloutPlanner.ParseFilter("timezonecode"), null);
            Assert.AreEqual("timezonecode", plan.Changes.Single().Effective.Definition.Attribute);
        }

        [TestMethod]
        public void Missing_attribute_on_current_counts_as_different()
        {
            var plan = RolloutPlanner.Plan(UserId, new[] { G() }, Member(), Current(), ApplyMode.Full, null, null);
            Assert.AreEqual(3, plan.Changes.Count);
        }

        [TestMethod]
        public void Reverse_conversion_round_trips()
        {
            foreach (var (attr, value) in new (string, object)[] {
                ("paginglimit", 50), ("dateformatstring", "dd-MM-yyyy"), ("showweeknumber", true), ("entityformmode", new OptionSetValue(2)),
                ("defaultdashboardid", Guid.NewGuid()), ("preferredsolution", new EntityReference("solution", Guid.NewGuid())),
                ("transactioncurrencyid", new EntityReference("transactioncurrency", Guid.NewGuid())) })
            {
                SettingsRegistry.TryGet(attr, out var d);
                var back = SettingValue.ToUserSettings(d, SettingValue.ToProfile(d, value));
                Assert.IsTrue(SettingValue.AreEqual(value, back), attr);
            }
        }
    }

    [TestClass]
    public class ChangeDetectorTests
    {
        [TestMethod]
        public void Value_and_mode_changes_are_listed()
        {
            var before = Global().With("paginglimit", SettingMode.Default, 50).With("timezonecode", SettingMode.Default, 105).With("showweeknumber", SettingMode.Locked, true);
            var after = Global().With("paginglimit", SettingMode.Default, 75).With("timezonecode", SettingMode.Locked, 105).With("showweeknumber", SettingMode.Locked, true);
            after.Id = before.Id;
            var c = ChangeDetector.Detect(before, after);
            Assert.IsFalse(c.Structural);
            CollectionAssert.AreEquivalent(new[] { "paginglimit", "timezonecode" }, c.ChangedSettings);
        }

        [TestMethod]
        public void Value_edit_on_inherit_setting_is_ignored()
        {
            var before = Global().With("paginglimit", SettingMode.Inherit, 50);
            var after = Global().With("paginglimit", SettingMode.Inherit, 75);
            Assert.IsFalse(ChangeDetector.Detect(before, after).Any);
        }

        [TestMethod]
        public void Switching_to_inherit_is_a_change()
        {
            var before = Global().With("paginglimit", SettingMode.Locked, 50);
            var after = Global().With("paginglimit", SettingMode.Inherit, 50);
            CollectionAssert.AreEqual(new[] { "paginglimit" }, ChangeDetector.Detect(before, after).ChangedSettings);
        }

        [TestMethod]
        public void Structural_changes()
        {
            var before = Group("G", 10);
            var after = Group("G", 20); after.Id = before.Id;
            Assert.IsTrue(ChangeDetector.Detect(before, after).Structural, "priority");
            after.Priority = 10; after.IsActive = false;
            Assert.IsTrue(ChangeDetector.Detect(before, after).Structural, "active");
            Assert.IsTrue(ChangeDetector.Detect(null, before).Structural, "create");
            Assert.IsTrue(ChangeDetector.Detect(before, null).Structural, "delete");
        }
    }
}
