using System;
using System.Diagnostics;
using System.Linq;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Mus.SpikeProbe
{
    /// <summary>
    /// Phase 0 diagnostic plugin. Logs execution context to mus_spikelog and runs the spike experiments.
    /// Unsecure config (one directive per line, all optional):
    ///   block=&lt;attribute&gt;            throw InvalidPluginExecutionException when Target contains it (SPIKE A2)
    ///   revert=&lt;attribute&gt;:&lt;int&gt;     overwrite Target attribute with the int value (silent revert, SPIKE A)
    ///   timing=true                     resolve team/BU membership and log elapsed ms (SPIKE F)
    ///   writesettings=&lt;attribute&gt;:&lt;int&gt; on Associate/Disassociate of a user, update that user's usersettings as SYSTEM (SPIKE C/D)
    ///   checksettings=true              on systemuser Create, check whether usersettings exists yet (SPIKE B)
    /// </summary>
    public class SpikeProbe : IPlugin
    {
        private readonly string _config;

        public SpikeProbe(string unsecureConfig, string secureConfig)
        {
            _config = unsecureConfig ?? string.Empty;
        }

        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            var system = factory.CreateOrganizationService(null);

            // Shared environment safeguard: only act on the spike user (config onlyuser=<guid>).
            if (!InScope(ctx)) return;

            var log = new StringBuilder();
            log.AppendLine($"Message={ctx.MessageName} Entity={ctx.PrimaryEntityName} Stage={ctx.Stage} Mode={ctx.Mode} Depth={ctx.Depth}");
            log.AppendLine($"UserId={ctx.UserId} InitiatingUserId={ctx.InitiatingUserId} BU={ctx.BusinessUnitId} Correlation={ctx.CorrelationId}");
            log.AppendLine($"Config={_config.Replace("\r", "").Replace("\n", " | ")}");
            foreach (var kv in ctx.SharedVariables) log.AppendLine($"Shared[{kv.Key}]={kv.Value}");

            if (ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity target
                && !(ctx.MessageName == "Create" && ctx.PrimaryEntityName == "systemuser"))
            {
                log.AppendLine($"Target {target.LogicalName} {target.Id}:");
                foreach (var a in target.Attributes) log.AppendLine($"  {a.Key} = {Format(a.Value)}");
            }
            if (ctx.InputParameters.Contains("Relationship"))
            {
                var rel = (Relationship)ctx.InputParameters["Relationship"];
                var tref = ctx.InputParameters["Target"] as EntityReference;
                var related = ctx.InputParameters["RelatedEntities"] as EntityReferenceCollection;
                log.AppendLine($"Relationship={rel.SchemaName} Target={tref?.LogicalName}:{tref?.Id}");
                if (related != null) foreach (var r in related) log.AppendLine($"  Related {r.LogicalName}:{r.Id}");
            }

            var title = $"{ctx.MessageName} {ctx.PrimaryEntityName} s{ctx.Stage} m{ctx.Mode} d{ctx.Depth}";
            try
            {
                RunExperiments(ctx, system, log);
            }
            catch (InvalidPluginExecutionException)
            {
                WriteLog(system, title + " BLOCK", log.ToString(), trace);
                throw;
            }
            catch (Exception ex)
            {
                log.AppendLine("Experiment error: " + ex);
            }
            WriteLog(system, title, log.ToString(), trace);
        }

        private void RunExperiments(IPluginExecutionContext ctx, IOrganizationService system, StringBuilder log)
        {
            var target = ctx.InputParameters.Contains("Target") ? ctx.InputParameters["Target"] as Entity : null;

            if (ctx.MessageName == "Update" && ctx.PrimaryEntityName == "usersettings" && target != null)
            {
                if (Get("timing") == "true") Timing(system, target.Id, log);

                var revert = Get("revert");
                if (revert != null && ctx.Stage == 20)
                {
                    var p = revert.Split(':');
                    if (target.Contains(p[0]))
                    {
                        log.AppendLine($"REVERT {p[0]}: {Format(target[p[0]])} -> {p[1]}");
                        target[p[0]] = int.Parse(p[1]);
                    }
                }

                var block = Get("block");
                if (block != null && ctx.Stage == 20 && target.Contains(block))
                {
                    log.AppendLine($"BLOCK on {block}");
                    throw new InvalidPluginExecutionException(
                        $"The setting '{block}' is managed by your administrator and cannot be changed.");
                }
            }

            if (ctx.MessageName == "Create" && ctx.PrimaryEntityName == "systemuser" && Get("checksettings") == "true")
            {
                var q = new QueryExpression("usersettings") { ColumnSet = new ColumnSet("systemuserid", "createdon") };
                q.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, ctx.PrimaryEntityId);
                var found = system.RetrieveMultiple(q).Entities.Count;
                log.AppendLine($"SPIKE B: usersettings rows for new user at this stage = {found}");
            }

            var write = Get("writesettings");
            if (write != null && (ctx.MessageName == "Associate" || ctx.MessageName == "Disassociate")
                && ctx.InputParameters["Relationship"] is Relationship rel && rel.SchemaName == "teammembership_association")
            {
                var users = ((EntityReferenceCollection)ctx.InputParameters["RelatedEntities"])
                    .Where(r => r.LogicalName == "systemuser").Select(r => r.Id).ToList();
                var tref = (EntityReference)ctx.InputParameters["Target"];
                if (tref.LogicalName == "systemuser") users.Add(tref.Id);

                var p = write.Split(':');
                foreach (var uid in users)
                {
                    var sw = Stopwatch.StartNew();
                    var us = new Entity("usersettings", uid) { [p[0]] = int.Parse(p[1]) };
                    system.Update(us);
                    log.AppendLine($"SPIKE C: SYSTEM updated usersettings {uid} {p[0]}={p[1]} in {sw.ElapsedMilliseconds} ms");
                }
            }
        }

        private static void Timing(IOrganizationService svc, Guid userId, StringBuilder log)
        {
            var sw = Stopwatch.StartNew();
            var user = svc.Retrieve("systemuser", userId, new ColumnSet("businessunitid"));
            var bu = user.GetAttributeValue<EntityReference>("businessunitid");
            var hops = 0;
            var current = bu;
            while (current != null && hops < 20)
            {
                var b = svc.Retrieve("businessunit", current.Id, new ColumnSet("parentbusinessunitid"));
                current = b.GetAttributeValue<EntityReference>("parentbusinessunitid");
                hops++;
            }
            var tm = new QueryExpression("teammembership") { ColumnSet = new ColumnSet("teamid") };
            tm.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, userId);
            var teams = svc.RetrieveMultiple(tm).Entities.Count;
            log.AppendLine($"SPIKE F: user BU + {hops} BU hops + {teams} team memberships resolved in {sw.ElapsedMilliseconds} ms");
        }

        private bool InScope(IPluginExecutionContext ctx)
        {
            if (ctx.MessageName == "Create" && ctx.PrimaryEntityName == "systemuser") return true; // SPIKE B, no attributes logged
            var only = Get("onlyuser");
            if (only == null) return false;
            var me = Guid.Parse(only);
            if (ctx.MessageName == "Associate" || ctx.MessageName == "Disassociate")
            {
                if (!(ctx.InputParameters["Relationship"] is Relationship rel) || rel.SchemaName != "teammembership_association") return false;
                var tref = (EntityReference)ctx.InputParameters["Target"];
                var related = (EntityReferenceCollection)ctx.InputParameters["RelatedEntities"];
                return tref.Id == me || related.Any(r => r.Id == me);
            }
            return ctx.PrimaryEntityId == me;
        }

        private string Get(string key)
        {
            foreach (var line in _config.Split(new[] { '\n', '\r', ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var i = line.IndexOf('=');
                if (i > 0 && line.Substring(0, i).Trim() == key) return line.Substring(i + 1).Trim();
            }
            return null;
        }

        private static string Format(object v)
        {
            switch (v)
            {
                case null: return "null";
                case EntityReference r: return $"{r.LogicalName}:{r.Id}";
                case OptionSetValue o: return $"option:{o.Value}";
                case Money m: return $"money:{m.Value}";
                default: return v.ToString();
            }
        }

        private static void WriteLog(IOrganizationService svc, string title, string detail, ITracingService trace)
        {
            trace.Trace(detail);
            var e = new Entity("mus_spikelog")
            {
                ["mus_name"] = title.Length > 100 ? title.Substring(0, 100) : title,
                ["mus_detail"] = detail.Length > 100000 ? detail.Substring(0, 100000) : detail
            };
            svc.Create(e);
        }
    }
}
