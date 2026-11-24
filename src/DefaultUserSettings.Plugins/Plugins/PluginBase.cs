using System;
using System.ServiceModel;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Plugins
{
    public sealed class LocalContext
    {
        public LocalContext(IServiceProvider sp)
        {
            Context = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
            Trace = (ITracingService)sp.GetService(typeof(ITracingService));
            var factory = (IOrganizationServiceFactory)sp.GetService(typeof(IOrganizationServiceFactory));
            SystemService = factory.CreateOrganizationService(null);
        }

        public IPluginExecutionContext Context { get; }
        public ITracingService Trace { get; }
        /// <summary>SYSTEM context (SPIKE C): can read config and write any user's usersettings.</summary>
        public IOrganizationService SystemService { get; }

        public Entity Target => Context.InputParameters.Contains("Target") ? Context.InputParameters["Target"] as Entity : null;

        public Entity PreImage(string name = "PreImage") =>
            Context.PreEntityImages.Contains(name) ? Context.PreEntityImages[name] : null;

        /// <summary>True when a rollout set the shared variable anywhere in the context chain.</summary>
        public bool IsRollout()
        {
            for (IPluginExecutionContext c = Context; c != null; c = c.ParentContext)
            {
                if (c.SharedVariables.Contains(Names.SharedVariableRollout)) return true;
                if (c.SharedVariables.TryGetValue("tag", out var tag) && Names.RolloutTag.Equals(tag as string)) return true;
            }
            return false;
        }
    }

    public abstract class PluginBase : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var local = new LocalContext(serviceProvider);
            try
            {
                Execute(local);
            }
            catch (InvalidPluginExecutionException)
            {
                throw;
            }
            catch (FaultException<OrganizationServiceFault> ex)
            {
                local.Trace.Trace("Dataverse fault: {0}", ex);
                throw new InvalidPluginExecutionException($"{GetType().Name}: {ex.Detail?.Message ?? ex.Message}", ex);
            }
            catch (Exception ex)
            {
                local.Trace.Trace("Unexpected error: {0}", ex);
                throw new InvalidPluginExecutionException($"{GetType().Name}: {ex.Message}", ex);
            }
        }

        protected abstract void Execute(LocalContext local);
    }
}
