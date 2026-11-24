namespace DefaultUserSettings.Plugins
{
    /// <summary>Logical names and option values. Option values use the publisher option prefix 63249.</summary>
    public static class Names
    {
        public const string SharedVariableRollout = "jhrb_rollout";
        /// <summary>Request "tag" parameter; surfaces as SharedVariables["tag"] in the child pipeline.</summary>
        public const string RolloutTag = "jhrb_rollout";

        public static class Job
        {
            public const string Entity = "jhrb_rolloutjob";
            public const string Id = "jhrb_rolloutjobid";
            public const string Name = "jhrb_name";
            public const string Status = "jhrb_status";
            public const string Scope = "jhrb_scope";
            public const string ApplyMode = "jhrb_applymode";
            public const string Reason = "jhrb_reason";
            public const string User = "jhrb_user";
            public const string Profile = "jhrb_profile";
            public const string SettingFilter = "jhrb_settingfilter";
            public const string DryRun = "jhrb_dryrun";
            public const string IgnorePilot = "jhrb_ignorepilot";
            public const string Cursor = "jhrb_cursor";
            public const string BatchSize = "jhrb_batchsize";
            public const string ChunkSeconds = "jhrb_chunkseconds";
            public const string Processed = "jhrb_processed";
            public const string Updated = "jhrb_updated";
            public const string Unchanged = "jhrb_unchanged";
            public const string Failed = "jhrb_failed";
            public const string Chunks = "jhrb_chunks";
            public const string Continue = "jhrb_continue";
            public const string StartedOn = "jhrb_startedon";
            public const string CompletedOn = "jhrb_completedon";
            public const string Error = "jhrb_error";
        }

        public static class UserState
        {
            public const string Entity = "jhrb_userstate";
            public const string Id = "jhrb_userstateid";
            public const string Name = "jhrb_name";
            public const string User = "jhrb_user";
            public const string Fingerprint = "jhrb_layerfingerprint";
            public const string LastFullApplyOn = "jhrb_lastfullapplyon";
            public const string InitializedOn = "jhrb_initializedon";
        }

        public static class Heartbeat
        {
            public const string Entity = "jhrb_heartbeat";
            public const string Name = "jhrb_name";
        }

        public static class Profile
        {
            public const string Entity = "jhrb_settingsprofile";
            public const string Id = "jhrb_settingsprofileid";
            public const string Name = "jhrb_name";
            public const string Type = "jhrb_type";
            public const string Priority = "jhrb_priority";
            public const string IsActive = "jhrb_isactive";
            public const string User = "jhrb_user";
            public const string PilotTeam = "jhrb_pilotteam";
            public const string CreatedOn = "createdon";
        }

        public static class Scope
        {
            public const string Entity = "jhrb_profilescope";
            public const string Id = "jhrb_profilescopeid";
            public const string Name = "jhrb_name";
            public const string Profile = "jhrb_profile";
            public const string ScopeType = "jhrb_scopetype";
            public const string Team = "jhrb_team";
            public const string BusinessUnit = "jhrb_businessunit";
            public const string IncludeChildBusinessUnits = "jhrb_includechildbu";
        }

        public static class Log
        {
            public const string Entity = "jhrb_settingslog";
            public const string Name = "jhrb_name";
            public const string User = "jhrb_user";
            public const string Setting = "jhrb_setting";
            public const string OldValue = "jhrb_oldvalue";
            public const string AttemptedValue = "jhrb_attemptedvalue";
            public const string AppliedValue = "jhrb_appliedvalue";
            public const string Source = "jhrb_source";
            public const string Profile = "jhrb_profile";
            public const string TimeToLive = "ttlinseconds";
            public const int TimeToLiveSeconds = 90 * 24 * 60 * 60;
        }

        public static class UserSettings
        {
            public const string Entity = "usersettings";
            public const string Id = "systemuserid";
        }
    }

    public enum SettingMode
    {
        Inherit = 632490000,
        Default = 632490001,
        Locked = 632490002
    }

    public enum ProfileType
    {
        Global = 632490000,
        Group = 632490001,
        User = 632490002
    }

    public enum ScopeType
    {
        Team = 632490000,
        BusinessUnit = 632490001
    }

    public enum JobStatus { Pending = 632490000, Running = 632490001, Completed = 632490002, Failed = 632490003, Cancelled = 632490004 }

    public enum JobScope { All = 632490000, User = 632490001 }

    /// <summary>Full: Default + Locked. LockedOnly: enforce locks. Auto: Full when the user's layers changed or the user was never initialized, else LockedOnly.</summary>
    public enum ApplyMode { Full = 632490000, LockedOnly = 632490001, Auto = 632490002 }

    public enum JobReason { Manual = 632490000, ProfileChange = 632490001, NewUser = 632490002, Membership = 632490003, Reconcile = 632490004, UserOverride = 632490005 }

    public enum LogSource
    {
        Rollout = 632490000,
        NewUser = 632490001,
        Revert = 632490002,
        Manual = 632490003,
        GroupChange = 632490004
    }
}
