"""Shared Matplotlib figures for the notebook and public article."""
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

plt.rcdefaults()
BLUE,ORANGE,RED,PURPLE='#1f77b4','#ff7f0e','#c44e52','#8060a2'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,
    'figure.facecolor':'white','axes.facecolor':'white','savefig.facecolor':'white',
    'axes.spines.top':False,'axes.spines.right':False,
    'axes.edgecolor':'#b8b8b8','axes.labelcolor':'#333333','text.color':'#222222',
    'xtick.color':'#555555','ytick.color':'#555555','legend.frameon':False,'svg.fonttype':'none'})

def canvas(index,nrows,heights,title,compact=False):
    fig,axes=plt.subplots(nrows,1,figsize=(5.6 if compact else 11.3,sum(heights)+(2.15 if compact else 1.15)),sharex=True,
        gridspec_kw={'height_ratios':heights},layout='constrained')
    if title:fig.suptitle(title,fontsize=15,ha='left',x=.085)
    for ax in axes:
        ax.grid(alpha=.2,lw=.6);ax.set_axisbelow(True)
        ax.axvspan(index.index.min(),pd.Timestamp('2026-05-01',tz='UTC'),
            facecolor='#eeeeee',alpha=.45,zorder=0)
        ax.axvline(pd.Timestamp('2026-05-01',tz='UTC'),color='#999999',ls=':',lw=.8)
        ax.set_xlim(index.index.min(),index.index.max());ax.tick_params(axis='both',labelsize=9)
        ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4 if compact else 6,maxticks=5 if compact else 9))
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    axes[-1].set_xlabel('Date (UTC), 2026')
    return fig,axes

def highlight(ax,events):
    for _,event in events.iterrows():
        ax.axvspan(event.start,event.end+pd.Timedelta(days=1),
            color=BLUE if event.direction=='Above' else RED,alpha=.075,zorder=0)

def legend_above(ax,columns=2,compact=False):
    ax.legend(loc='lower left',bbox_to_anchor=(0,1),borderaxespad=0,
              fontsize=9,ncol=1 if compact else columns)

def history_figure(model,index,breadth,events,parameters,compact=False,title=True):
    band_pct=100*np.expm1(parameters['width'])
    fig,axes=canvas(index,4,[3.1,1.7,1.7,.85],
        'Figure 1. How large, how persistent, how widespread?' if title else None,compact)
    ax=axes[0];highlight(ax,events)
    ax.plot(model.index,model.observed,color=BLUE,lw=1.7,label='Price index')
    ax.plot(model.index,model.baseline,color=ORANGE,ls='--',lw=1.6,label='Baseline')
    ax.fill_between(model.index,model.lower,model.upper,color=ORANGE,alpha=.25,label='April reference range')
    ax.set_ylabel('Price index\nApril 30 = 100');legend_above(ax,columns=3,compact=compact)
    ax.set_ylim(85,260);ax.set_yticks([100,150,200,250])
    ax=axes[1];highlight(ax,events)
    ax.axhspan(100*np.expm1(-parameters['width']),band_pct,color=ORANGE,alpha=.18)
    ax.plot(model.index,model.deviation_pct,color=BLUE,lw=1.3)
    ax.axhline(0,color='#888888',lw=.7);ax.set_ylabel('Deviation from\nbaseline (%)');ax.set_ylim(-5,138)
    ax.set_yticks([0,25,50,75,100,125])
    ax=axes[2];highlight(ax,events)
    ax.plot(breadth.index,100*breadth.above_share,color=BLUE,lw=1.3,label='Prices >10% above April')
    ax.plot(breadth.index,100*breadth.below_share,color=RED,lw=1.2,label='Prices >10% below April')
    ax.set_ylabel('Hosts (%)');ax.set_ylim(0,105);ax.set_yticks([0,25,50,75,100])
    legend_above(ax,compact=compact)
    ax=axes[3];highlight(ax,events)
    ax.plot(index.index,index.matched_machines,color=BLUE,lw=1.1)
    ax.set_ylabel('Machines\ncompared');ax.set_ylim(0,235);ax.set_yticks([0,100,200])
    return fig

def distribution_figure(components,component_models,component_events,days,compact=False,title=True):
    fig,axes=canvas(components,4,[2.1,2.1,2.1,.95],
        'Figure 2. Where in the distribution did prices change?' if title else None,compact)
    for ax,name,label in zip(axes[:3],['lower','median','upper'],[
            'Lower change (10th percentile)','Median change','Upper change (95th percentile)']):
        ax.plot(components.index,components[name]-100,color=BLUE,lw=1.6,label=label)
        if name in component_models:
            fitted=component_models[name]
            for _,event in component_events[component_events.component.eq(name)].iterrows():
                ax.axvspan(event.start,event.end+pd.Timedelta(days=1),color=BLUE,alpha=.075,zorder=0)
            ax.plot(fitted.index,fitted.baseline-100,color=ORANGE,ls='--',lw=1.5,label='Baseline')
            ax.fill_between(fitted.index,fitted.lower-100,fitted.upper-100,color=ORANGE,alpha=.2)
        else:
            ax.plot(components.index,np.zeros(len(components)),color='#777777',ls='--',lw=1,
                    label='April reference (no fitted band)')
        ax.axhline(0,color='#888888',lw=.7)
        ax.set_ylabel('Change from own\nApril price (%)')
        legend_above(ax,compact=compact)
    axes[0].set_ylim(-25,90);axes[0].set_yticks([-25,0,25,50,75])
    axes[1].set_ylim(-30,265);axes[1].set_yticks([0,50,100,150,200,250])
    axes[2].set_ylim(-30,630);axes[2].set_yticks([0,150,300,450,600])
    ax=axes[3]
    ax.plot(components.index,100*components.cohort_share,color=BLUE,lw=1.1,label='Cohort machines listed')
    ax.plot(days.index,100*days.capped_share,color='#777777',lw=1,ls='--',label='Searches at the 64-listing cap')
    ax.set_ylim(0,108);ax.set_yticks([0,50,100]);ax.set_ylabel('Coverage (%)')
    legend_above(ax,compact=compact)
    return fig


def article_axis(dates, compact=False):
    """A single panel for the article; full diagnostics remain in the notebook."""
    fig, ax = plt.subplots(figsize=(4.2, 3.2) if compact else (9.2, 3.6),
                           layout='constrained')
    fig.patch.set_alpha(0)
    ax.set_facecolor('none')
    ax.spines[['left', 'top', 'right']].set_visible(False)
    ax.grid(axis='y', color='#dddddd', linewidth=.6)
    ax.set_axisbelow(True)
    ax.set_xlim(dates.min(), dates.max())
    ax.tick_params(axis='both', labelsize=10 if compact else 11, length=0, pad=8)
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2 if compact else 1))
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b'))
    return fig, ax


def article_price_figure(model, compact=False):
    fig, ax = article_axis(model.index, compact)
    ax.plot(model.index, model.observed, color=BLUE, linewidth=1.8, label='Price index')
    ax.plot(model.index, model.baseline, color=ORANGE, linewidth=1.5,
            linestyle='--', label='Baseline')
    ax.fill_between(model.index, model.lower, model.upper, color=ORANGE,
                    alpha=.20, linewidth=0, label='April range')
    ax.set_ylim(85, 255)
    ax.set_yticks([100, 150, 200, 250])
    ax.legend(loc='lower left', bbox_to_anchor=(0, 1.025), borderaxespad=0,
              ncol=3, fontsize=9 if compact else 11,
              columnspacing=1.1, handlelength=1.8, handletextpad=.5)
    return fig


def article_breadth_figure(breadth, compact=False):
    fig, ax = article_axis(breadth.index, compact)
    ax.plot(breadth.index, 100 * breadth.above_share, color=BLUE,
            linewidth=1.8, label='Increase above 10%')
    ax.plot(breadth.index, 100 * breadth.doubled_share, color=BLUE,
            linewidth=1.5, linestyle='--', label='Increase above 100%')
    ax.set_ylim(-3, 105)
    ax.set_yticks([0, 25, 50, 75, 100], ['0%', '25%', '50%', '75%', '100%'])
    # This comparison begins in May, after the April references are established.
    ax.xaxis.set_major_locator(mdates.MonthLocator())
    ax.legend(loc='lower left', bbox_to_anchor=(0, 1.025), borderaxespad=0,
              ncol=1 if compact else 2, fontsize=10 if compact else 11,
              columnspacing=1.8, handlelength=2.3)
    return fig
