using System;
using DefaultUserSettings.Plugins.Enforcement;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Resolution;
using DefaultUserSettings.Plugins.Validation;
using DefaultUserSettings.Plugins.Values;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.Xrm.Sdk;
using static DefaultUserSettings.Plugins.Tests.Build;

namespace DefaultUserSettings.Plugins.Tests
{
    [TestClass]
    public class EnforcerTests
    {
        private static Entity Target(params (string, object)[] values)
        {
            var e = new Entity("usersettings", UserId);
            foreach (var (k, v) in values) e[k] = v;
            e["modifiedon"] = DateTime.UtcNow;
            return e;
        }

        [TestMethod]
        public void Locked_change_is_reverted_and_unlocked_change_kept()
        {
            var g = Global().With("paginglimit", SettingMode.Locked, 50).With("timezonecode", SettingMode.Default, 105);
            var target = Target(("paginglimit", 100), ("timezonecode", 110));
            var reverts = LockEnforcer.Enforce(target, ProfileResolver.Resolve(new[] { g }, Member()));

            Assert.AreEqual(1, reverts.Count);
            Assert.AreEqual(50, target["paginglimit"]);
            Assert.AreEqual(100, reverts[0].Attempted);
            Assert.AreEqual(110, target["timezonecode"], "Default (unlocked) is left alone");
        }

        [TestMethod]
        public void Unchanged_locked_value_is_not_logged()
        {
            var g = Global().With("paginglimit", SettingMode.Locked, 50);
            var reverts = LockEnforcer.Enforce(Target(("paginglimit", 50)), ProfileResolver.Resolve(new[] { g }, Member()));
            Assert.AreEqual(0, reverts.Count);
        }

        [TestMethod]
        public void Unmanaged_attributes_are_ignored()
        {
            var g = Global().With("paginglimit", SettingMode.Locked, 50);
            var target = Target(("lastalertsviewedtime", DateTime.UtcNow));
            Assert.IsFalse(LockEnforcer.TouchesManagedSetting(target));
            Assert.AreEqual(0, LockEnforcer.Enforce(target, ProfileResolver.Resolve(new[] { g }, Member())).Count);
        }

        [TestMethod]
        public void Choice_and_lookup_compare_by_value()
        {
            var cur = Guid.NewGuid();
            var g = Global()
                .With("entityformmode", SettingMode.Locked, new OptionSetValue(1))
                .With("transactioncurrencyid", SettingMode.Locked, new EntityReference("transactioncurrency", cur));
            var target = Target(("entityformmode", new OptionSetValue(1)), ("transactioncurrencyid", new EntityReference("transactioncurrency", cur)));
            Assert.AreEqual(0, LockEnforcer.Enforce(target, ProfileResolver.Resolve(new[] { g }, Member())).Count);

            var target2 = Target(("entityformmode", new OptionSetValue(2)));
            Assert.AreEqual(1, LockEnforcer.Enforce(target2, ProfileResolver.Resolve(new[] { g }, Member())).Count);
            Assert.AreEqual(1, ((OptionSetValue)target2["entityformmode"]).Value);
        }

        [TestMethod]
        public void Value_equality_rules()
        {
            Assert.IsTrue(SettingValue.AreEqual(null, ""));
            Assert.IsFalse(SettingValue.AreEqual("dd-MM-yyyy", "DD-MM-YYYY"), "format strings are case-sensitive");
            Assert.IsTrue(SettingValue.AreEqual(5, 5L));
            Assert.IsFalse(SettingValue.AreEqual(true, false));
        }
    }

    [TestClass]
    public class ValidatorTests
    {
        [TestMethod]
        public void Only_one_global()
        {
            var errors = ProfileValidator.Validate(Global(), new[] { Global("Existing") });
            StringAssert.Contains(string.Join(" ", errors), "Only one Global");
        }

        [TestMethod]
        public void Updating_the_global_row_itself_is_fine()
        {
            var g = Global();
            Assert.AreEqual(0, ProfileValidator.Validate(g, new[] { g }).Count);
        }

        [TestMethod]
        public void Group_priority_required_and_unique()
        {
            var noPriority = Group("A", 1); noPriority.Priority = null;
            StringAssert.Contains(string.Join(" ", ProfileValidator.Validate(noPriority, new SettingsProfile[0])), "Priority is required");
            StringAssert.Contains(string.Join(" ", ProfileValidator.Validate(Group("A", 10), new[] { Group("B", 10) })), "priority 10");
            Assert.AreEqual(0, ProfileValidator.Validate(Group("A", 10), new[] { Group("B", 20) }).Count);
        }

        [TestMethod]
        public void User_profile_needs_unique_user()
        {
            var u = User(UserId); u.UserId = null;
            StringAssert.Contains(string.Join(" ", ProfileValidator.Validate(u, new SettingsProfile[0])), "User is required");
            StringAssert.Contains(string.Join(" ", ProfileValidator.Validate(User(UserId), new[] { User(UserId) })), "already has");
        }

        [TestMethod]
        public void Managed_setting_needs_value_and_valid_guid()
        {
            var g = Global().With("timezonecode", SettingMode.Locked, null).With("defaultdashboardid", SettingMode.Default, "not-a-guid");
            var all = string.Join(" ", ProfileValidator.Validate(g, new SettingsProfile[0]));
            StringAssert.Contains(all, "'Time Zone' is set to Locked but has no value");
            StringAssert.Contains(all, "'Default Dashboard' must be a GUID");
        }

        [TestMethod]
        public void Pilot_team_only_on_global()
        {
            var grp = Group("G", 1); grp.PilotTeamId = TeamA;
            StringAssert.Contains(string.Join(" ", ProfileValidator.Validate(grp, new SettingsProfile[0])), "Pilot team");
        }

        [TestMethod]
        public void Scope_rules()
        {
            var ok = TeamScope(TeamA); ok.ProfileId = Guid.NewGuid();
            Assert.AreEqual(0, ProfileValidator.Validate(ok, ProfileType.Group).Count);
            StringAssert.Contains(string.Join(" ", ProfileValidator.Validate(ok, ProfileType.Global)), "only be added to Group");

            var both = BuScope(RootBu); both.ProfileId = Guid.NewGuid(); both.TeamId = TeamA;
            StringAssert.Contains(string.Join(" ", ProfileValidator.Validate(both, ProfileType.Group)), "cannot have a team");

            var empty = new ProfileScope { ProfileId = Guid.NewGuid(), ScopeType = ScopeType.Team };
            StringAssert.Contains(string.Join(" ", ProfileValidator.Validate(empty, ProfileType.Group)), "Team is required");
        }
    }
}
