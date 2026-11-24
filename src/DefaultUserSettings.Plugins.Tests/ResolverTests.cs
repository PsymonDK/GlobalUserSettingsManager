using System.Linq;
using DefaultUserSettings.Plugins.Registry;
using DefaultUserSettings.Plugins.Resolution;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.Xrm.Sdk;
using static DefaultUserSettings.Plugins.Tests.Build;

namespace DefaultUserSettings.Plugins.Tests
{
    [TestClass]
    public class ResolverTests
    {
        [TestMethod]
        public void Global_only_supplies_value_and_lock()
        {
            var g = Global().With("paginglimit", SettingMode.Locked, 50).With("timezonecode", SettingMode.Default, 105);
            var eff = ProfileResolver.Resolve(new[] { g }, Member());
            Assert.AreEqual(50, eff["paginglimit"].Value);
            Assert.IsTrue(eff["paginglimit"].Locked);
            Assert.IsFalse(eff["timezonecode"].Locked);
        }

        [TestMethod]
        public void Inherit_on_global_means_unmanaged()
        {
            var g = Global().With("paginglimit", SettingMode.Inherit, 50);
            var eff = ProfileResolver.Resolve(new[] { g }, Member());
            Assert.IsFalse(eff.ContainsKey("paginglimit"));
        }

        [TestMethod]
        public void Higher_priority_group_wins_per_setting_and_lower_layers_fill_gaps()
        {
            var g = Global().With("paginglimit", SettingMode.Default, 50).With("timezonecode", SettingMode.Locked, 105).With("showweeknumber", SettingMode.Default, false);
            var low = Group("Low", 10, TeamScope(TeamA)).With("paginglimit", SettingMode.Default, 75).With("timezonecode", SettingMode.Default, 110);
            var high = Group("High", 20, TeamScope(TeamB)).With("paginglimit", SettingMode.Locked, 100);

            var eff = ProfileResolver.Resolve(new[] { g, low, high }, Member(TeamA, TeamB));

            Assert.AreEqual(100, eff["paginglimit"].Value);
            Assert.AreEqual("High", eff["paginglimit"].Source.Name);
            Assert.AreEqual(110, eff["timezonecode"].Value, "High inherits timezone, so Low wins");
            Assert.IsFalse(eff["timezonecode"].Locked, "Strict priority: a higher layer may unlock a Global lock");
            Assert.AreEqual(false, eff["showweeknumber"].Value);
            Assert.AreEqual("Global", eff["showweeknumber"].Source.Name);
        }

        [TestMethod]
        public void User_override_beats_groups()
        {
            var g = Global().With("paginglimit", SettingMode.Locked, 50);
            var grp = Group("G", 10, TeamScope(TeamA)).With("paginglimit", SettingMode.Locked, 75);
            var u = User(UserId).With("paginglimit", SettingMode.Default, 250);
            var eff = ProfileResolver.Resolve(new[] { g, grp, u }, Member(TeamA));
            Assert.AreEqual(250, eff["paginglimit"].Value);
            Assert.IsFalse(eff["paginglimit"].Locked);
        }

        [TestMethod]
        public void Other_users_override_is_ignored()
        {
            var g = Global().With("paginglimit", SettingMode.Default, 50);
            var other = User(System.Guid.NewGuid()).With("paginglimit", SettingMode.Default, 250);
            Assert.AreEqual(50, ProfileResolver.Resolve(new[] { g, other }, Member())["paginglimit"].Value);
        }

        [TestMethod]
        public void Inactive_group_is_ignored()
        {
            var g = Global().With("paginglimit", SettingMode.Default, 50);
            var grp = Group("G", 10, TeamScope(TeamA)).With("paginglimit", SettingMode.Default, 75);
            grp.IsActive = false;
            Assert.AreEqual(50, ProfileResolver.Resolve(new[] { g, grp }, Member(TeamA))["paginglimit"].Value);
        }

        [TestMethod]
        public void Group_without_matching_scope_is_ignored()
        {
            var g = Global().With("paginglimit", SettingMode.Default, 50);
            var grp = Group("G", 10, TeamScope(TeamA)).With("paginglimit", SettingMode.Default, 75);
            Assert.AreEqual(50, ProfileResolver.Resolve(new[] { g, grp }, Member(TeamB))["paginglimit"].Value);
        }

        [TestMethod]
        public void Business_unit_scope_exact_and_with_children()
        {
            var user = Member();
            Assert.IsTrue(ProfileResolver.Matches(BuScope(GrandChildBu), user), "own BU");
            Assert.IsFalse(ProfileResolver.Matches(BuScope(ChildBu), user), "parent BU without children flag");
            Assert.IsTrue(ProfileResolver.Matches(BuScope(ChildBu, includeChildren: true), user), "parent BU with children");
            Assert.IsTrue(ProfileResolver.Matches(BuScope(RootBu, includeChildren: true), user), "root BU with children");
            Assert.IsFalse(ProfileResolver.Matches(BuScope(System.Guid.NewGuid(), true), user), "unrelated BU");
        }

        [TestMethod]
        public void One_group_can_cover_several_teams_and_business_units()
        {
            var grp = Group("Nordics", 10, TeamScope(TeamA), BuScope(ChildBu, true));
            Assert.IsTrue(ProfileResolver.Matches(grp, Member()), "via BU");
            Assert.IsTrue(ProfileResolver.Matches(grp, new Model.UserMembership(UserId, System.Guid.NewGuid(), new System.Guid[0], new[] { TeamA })), "via team");
        }

        [TestMethod]
        public void Equal_priority_tie_breaks_by_createdon()
        {
            var g = Global();
            var first = Group("First", 10, TeamScope(TeamA)).With("paginglimit", SettingMode.Default, 75);
            var second = Group("Second", 10, TeamScope(TeamA)).With("paginglimit", SettingMode.Default, 100);
            second.CreatedOn = first.CreatedOn.AddDays(1);
            Assert.AreEqual("First", ProfileResolver.Resolve(new[] { g, second, first }, Member(TeamA))["paginglimit"].Source.Name);
        }

        [TestMethod]
        public void Mode_set_but_no_value_is_treated_as_unmanaged()
        {
            var g = Global().With("timezonecode", SettingMode.Default, 105);
            var grp = Group("G", 10, TeamScope(TeamA)).With("timezonecode", SettingMode.Locked, null);
            Assert.IsFalse(ProfileResolver.Resolve(new[] { g, grp }, Member(TeamA)).ContainsKey("timezonecode"));
        }

        [TestMethod]
        public void Values_are_converted_to_usersettings_types()
        {
            var dashboard = System.Guid.NewGuid();
            var currency = System.Guid.NewGuid();
            var g = Global()
                .With("entityformmode", SettingMode.Default, new OptionSetValue(2))
                .With("defaultdashboardid", SettingMode.Default, dashboard.ToString())
                .With("transactioncurrencyid", SettingMode.Default, new EntityReference("transactioncurrency", currency))
                .With("preferredsolution", SettingMode.Default, dashboard.ToString());
            var eff = ProfileResolver.Resolve(new[] { g }, Member());
            Assert.AreEqual(2, ((OptionSetValue)eff["entityformmode"].Value).Value);
            Assert.AreEqual(dashboard, eff["defaultdashboardid"].Value);
            Assert.AreEqual("transactioncurrency", ((EntityReference)eff["transactioncurrencyid"].Value).LogicalName);
            Assert.AreEqual("solution", ((EntityReference)eff["preferredsolution"].Value).LogicalName);
        }

        [TestMethod]
        public void Pilot_team_limits_scope()
        {
            var g = Global(); g.PilotTeamId = TeamA;
            Assert.IsTrue(ProfileResolver.IsUserInScope(new[] { g }, Member(TeamA)));
            Assert.IsFalse(ProfileResolver.IsUserInScope(new[] { g }, Member(TeamB)));
            g.PilotTeamId = null;
            Assert.IsTrue(ProfileResolver.IsUserInScope(new[] { g }, Member()));
            g.IsActive = false;
            Assert.IsFalse(ProfileResolver.IsUserInScope(new[] { g }, Member()), "inactive Global = feature off");
        }

        [TestMethod]
        public void Registry_is_consistent()
        {
            Assert.AreEqual(61, SettingsRegistry.All.Count);
            Assert.AreEqual(SettingsRegistry.All.Count, SettingsRegistry.All.Select(s => s.Attribute).Distinct().Count());
            Assert.IsTrue(SettingsRegistry.All.All(s => s.ValueColumn == "jhrb_" + s.Attribute && s.ModeColumn == "jhrb_" + s.Attribute + "_mode"));
            Assert.IsTrue(SettingsRegistry.All.All(s => s.ModeColumn.Length <= 50));
            Assert.IsTrue(SettingsRegistry.IsManaged("PagingLimit"), "case-insensitive");
        }
    }
}
